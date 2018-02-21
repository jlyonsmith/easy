#!/usr/bin/env node
'use strict';

var _SnapTool = require('./SnapTool');

var _chalk = require('chalk');

var _chalk2 = _interopRequireDefault(_chalk);

var _path = require('path');

var _path2 = _interopRequireDefault(_path);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

const log = {
  info: console.error,
  info2: function () {
    console.error(_chalk2.default.green([...arguments].join(' ')));
  },
  error: function () {
    console.error(_chalk2.default.red('error:', [...arguments].join(' ')));
  },
  warning: function () {
    console.error(_chalk2.default.yellow('warning:', [...arguments].join(' ')));
  }
};

const tool = new _SnapTool.SnapTool(_path2.default.basename(process.argv[1], '.js'), log);

tool.run(process.argv.slice(2)).then(exitCode => {
  process.exitCode = exitCode;
}).catch(err => {
  console.error(err);
});
//# sourceMappingURL=snap.js.map