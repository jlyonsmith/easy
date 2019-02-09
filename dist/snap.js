#!/usr/bin/env node
"use strict";

var _SnapTool = require("./SnapTool");

var _chalk = _interopRequireDefault(require("chalk"));

var _path = _interopRequireDefault(require("path"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

const log = {
  info: console.error,
  info2: function () {
    console.error(_chalk.default.green([...arguments].join(" ")));
  },
  error: function () {
    console.error(_chalk.default.red("error:", [...arguments].join(" ")));
  },
  warning: function () {
    console.error(_chalk.default.yellow("warning:", [...arguments].join(" ")));
  },
  ansibleOK: function () {
    console.error(_chalk.default.green([...arguments].join(" ")));
  },
  ansibleChanged: function () {
    console.error(_chalk.default.yellow([...arguments].join(" ")));
  },
  ansibleSkipping: function () {
    console.error(_chalk.default.cyan([...arguments].join(" ")));
  },
  ansibleError: function () {
    console.error(_chalk.default.red([...arguments].join(" ")));
  }
};
const tool = new _SnapTool.SnapTool(_path.default.basename(process.argv[1], ".js"), log);
tool.run(process.argv.slice(2)).then(exitCode => {
  process.exitCode = exitCode;
}).catch(error => {
  process.exitCode = 200;

  if (error) {
    log.error(error.message);

    if (tool.debug) {
      console.error(error);
    }
  }
});
//# sourceMappingURL=snap.js.map