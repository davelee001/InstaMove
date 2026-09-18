using System.Collections.Concurrent;
using System.Runtime.InteropServices.WindowsRuntime;
using System.Text;
using System.Text.Json;
using Windows.Devices.Bluetooth;
using Windows.Devices.Bluetooth.GenericAttributeProfile;
using Windows.Devices.Radios;
using Windows.Storage.Streams;

internal static class Program
{
    // Service / request-write / response-notify UUIDs for instamove-psk/1.
    private static readonly Guid ServiceId = new("d1f0b001-7c44-4e70-9bc9-4c7037a18c01");
    private static readonly Guid RequestId = new("d1f0b002-7c44-4e70-9bc9-4c7037a18c01");
    private static readonly Guid ResponseId = new("d1f0b003-7c44-4e70-9bc9-4c7037a18c01");
    private static readonly object OutputLock = new();
    private static readonly ConcurrentDictionary<string, GattSession> Sessions = new();
    private static GattServiceProvider? Provider;
    private static GattLocalCharacteristic? Responses;
    private static Radio? Radio;

    private static void Emit(object message)
    {
        lock (OutputLock) { Console.WriteLine(JsonSerializer.Serialize(message)); Console.Out.Flush(); }
    }

    public static async Task<int> Main(string[] args)
    {
        try
        {
            var adapter = await BluetoothAdapter.GetDefaultAsync();
            if (args.Contains("--check"))
            {
                Emit(new { type = "capability", available = adapter != null,
                    peripheral = adapter?.IsPeripheralRoleSupported == true });
                return adapter?.IsPeripheralRoleSupported == true ? 0 : 1;
            }
            if (adapter == null || !adapter.IsPeripheralRoleSupported)
                throw new InvalidOperationException("peripheral_unsupported");
            Radio = await adapter.GetRadioAsync();
            if (Radio == null || Radio.State != RadioState.On)
                throw new InvalidOperationException("radio_off");
            Radio.StateChanged += (_, _) =>
            {
                if (Radio.State != RadioState.On)
                {
                    Provider?.StopAdvertising();
                    Emit(new { type = "status", state = "radio_off" });
                }
            };
            var created = await GattServiceProvider.CreateAsync(ServiceId);
            if (created.Error != BluetoothError.Success) throw new InvalidOperationException("service_unavailable");
            Provider = created.ServiceProvider;
            Provider.AdvertisementStatusChanged += (_, evt) => Emit(new {
                type = "status", state = evt.Status == GattServiceProviderAdvertisementStatus.Started
                    ? "advertising" : "unavailable"
            });
            var input = await Provider.Service.CreateCharacteristicAsync(RequestId, new GattLocalCharacteristicParameters {
                CharacteristicProperties = GattCharacteristicProperties.Write,
                WriteProtectionLevel = GattProtectionLevel.EncryptionAndAuthenticationRequired,
                UserDescription = "InstaMove encrypted request fragments"
            });
            var output = await Provider.Service.CreateCharacteristicAsync(ResponseId, new GattLocalCharacteristicParameters {
                CharacteristicProperties = GattCharacteristicProperties.Notify,
                ReadProtectionLevel = GattProtectionLevel.EncryptionAndAuthenticationRequired,
                UserDescription = "InstaMove encrypted response fragments"
            });
            if (input.Error != BluetoothError.Success || output.Error != BluetoothError.Success)
                throw new InvalidOperationException("characteristics_unavailable");
            Responses = output.Characteristic;
            input.Characteristic.WriteRequested += OnWrite;
            Provider.StartAdvertising(new GattServiceProviderAdvertisingParameters {
                IsConnectable = true, IsDiscoverable = true
            });
            // Only the parent process writes this pipe. EOF stops advertising.
            while (await Console.In.ReadLineAsync() is string line)
            {
                if (line.Length > 65536) break;
                using var document = JsonDocument.Parse(line);
                var command = document.RootElement;
                if (command.GetProperty("type").GetString() != "response") continue;
                var session = command.GetProperty("session").GetString();
                var data = command.GetProperty("data").GetString();
                if (session == null || data == null || data.Length > 16384) continue;
                await SendResponse(session, Encoding.UTF8.GetBytes(data));
            }
            return 0;
        }
        catch
        {
            Emit(new { type = "status", state = "unavailable" });
            return 1;
        }
        finally { Provider?.StopAdvertising(); }
    }

    private static async void OnWrite(GattLocalCharacteristic sender, GattWriteRequestedEventArgs args)
    {
        var deferral = args.GetDeferral();
        try
        {
            var request = await args.GetRequestAsync();
            if (request == null) return;
            var session = args.Session;
            var id = session.DeviceId.Id;
            if (request.Offset != 0 || request.Value.Length < 5 || request.Value.Length > 512 ||
                Responses == null || !Responses.SubscribedClients.Any(c => c.Session.DeviceId.Id == id) ||
                (!Sessions.ContainsKey(id) && Sessions.Count >= 8))
            {
                request.RespondWithProtocolError(0x0d);
                return;
            }
            if (Sessions.TryAdd(id, session))
            {
                session.SessionStatusChanged += (_, change) => {
                    if (change.Status == GattSessionStatus.Closed)
                    {
                        Sessions.TryRemove(id, out _);
                        Emit(new { type = "disconnect", session = id });
                    }
                };
            }
            var bytes = request.Value.ToArray();
            Emit(new { type = "frame", session = id, data = Convert.ToBase64String(bytes) });
            request.Respond();
        }
        catch { /* A disconnected peer must not terminate the peripheral. */ }
        finally { deferral.Complete(); }
    }

    private static async Task SendResponse(string id, byte[] data)
    {
        if (Responses == null) return;
        var client = Responses.SubscribedClients.FirstOrDefault(c => c.Session.DeviceId.Id == id);
        if (client == null) return;
        var chunkSize = Math.Min(508, Math.Max(1, (int)client.Session.MaxPduSize - 7));
        var count = (data.Length + chunkSize - 1) / chunkSize;
        if (count > 128) return;
        for (var index = 0; index < count; index++)
        {
            var length = Math.Min(chunkSize, data.Length - index * chunkSize);
            var frame = new byte[length + 4];
            frame[0] = (byte)index; frame[1] = (byte)(index >> 8);
            frame[2] = (byte)count; frame[3] = (byte)(count >> 8);
            Array.Copy(data, index * chunkSize, frame, 4, length);
            var result = await Responses.NotifyValueAsync(frame.AsBuffer(), client);
            if (result.Status != GattCommunicationStatus.Success) return;
        }
    }
}
