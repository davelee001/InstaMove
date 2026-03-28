function send(message) {
  console.log("NOTIFY:", message);
  return {
    success: true,
    message
  };
}

module.exports = { send };
