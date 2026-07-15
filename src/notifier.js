const logger = require("./logger");

function send(message) {
  logger.info("notification_sent", { message });
  return {
    success: true,
    message
  };
}

module.exports = { send };
