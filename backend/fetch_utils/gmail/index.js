const api = require("./api");
const oauth = require("./oauth");

module.exports = {
  ...oauth,
  ...api,
};
