# Native Windows Bluetooth

InstaMove includes a Windows GATT peripheral using the native Windows Runtime
API. It has been compiled and smoke-tested for advertising on the development
computer's Intel Bluetooth adapter. End-to-end pairing, fragmentation, and
notification delivery with a second physical device still require verification.

## Build and run

Requirements: Windows 10 build 19041 or newer, x64, a powered-on adapter supporting
the BLE peripheral role, Node.js as specified in `.nvmrc`, and the .NET 10 SDK to
build. The published helper is self-contained and needs no separately installed
.NET runtime. It runs hidden as a child of Node and stops when the parent closes
its input pipe. Build output is ignored by Git.

```powershell
npm run build:bluetooth:windows
./native/windows-bluetooth/publish/InstaMove.Bluetooth.exe --check
$env:BLUETOOTH_MODE = 'windows'
# Load a securely generated 32-byte hexadecimal key from your secret store:
$env:INSTAMOVE_BLUETOOTH_KEY = '<64 hexadecimal characters>'
npm start
```

Provision the same separate Bluetooth key to authorized clients through a secure
out-of-band process. Do not reuse the storage encryption key or API bearer tokens.
Possession of this key grants access to the existing payment/invoice request flow,
not administrative routes. The native helper receives no application secrets;
encryption and request validation happen in Node. Set
`INSTAMOVE_BLUETOOTH_HELPER` to an absolute executable path if deploying elsewhere.

`BLUETOOTH_MODE` accepts only `simulated`, `windows`, or `disabled`. Simulation is
the development default and is explicitly labeled in the web workspace. It cannot
satisfy readiness for real LND/regtest deployments. Missing keys, helper binaries,
adapter support, or advertising cause Windows readiness to fail; there is no
fallback to simulation. HTTP Bluetooth injection and uncorrelated broadcasts are
disabled in Windows mode. Restart the service after restoring a stopped radio.

## Trusted-device protocol: instamove-psk/1

This is a pre-shared-key transport for provisioned trusted devices. It is separate
from the draft `instamove/1` Noise/CBOR protocol, which is not implemented. It does
not provide forward secrecy, individual client identities, per-client revocation,
or deferred offline settlement. Rotate the shared key on all provisioned devices
if one is compromised. Do not present this as an open public-payer protocol.

Windows requires an authenticated, encrypted BLE link for writes. Pair the client
using Windows' pairing UI. Application messages additionally use the existing
AES-256-GCM envelope (`v1.nonce.tag.ciphertext`, base64url components, 12-byte
nonce, 16-byte tag, UTF-8 associated data `instamove:v1`) with the dedicated
Bluetooth key. Every encryption operation must use a fresh cryptographic nonce.

| GATT role | UUID |
| --- | --- |
