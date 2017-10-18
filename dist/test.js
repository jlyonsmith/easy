'use strict';

var _toposort = require('toposort');

var _toposort2 = _interopRequireDefault(_toposort);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

const pkgs = [{ filename: '/Users/john/Projects/Jamoki/TMR/address/package.json' }, { filename: '/Users/john/Projects/Jamoki/TMR/api/package.json' }, { filename: '/Users/john/Projects/Jamoki/TMR/bin/package.json' }, { filename: '/Users/john/Projects/Jamoki/TMR/database/package.json' }, { filename: '/Users/john/Projects/Jamoki/TMR/email/package.json' }, { filename: '/Users/john/Projects/Jamoki/TMR/hummus-dip/package.json' }, { filename: '/Users/john/Projects/Jamoki/TMR/image/package.json' }, { filename: '/Users/john/Projects/Jamoki/TMR/import/package.json' }, { filename: '/Users/john/Projects/Jamoki/TMR/message-service/package.json' }, { filename: '/Users/john/Projects/Jamoki/TMR/pdf/package.json' }, { filename: '/Users/john/Projects/Jamoki/TMR/website/package.json' }];

const sortedPkgs = _toposort2.default.array(pkgs, [[pkgs[2], pkgs[5]], [pkgs[9], pkgs[5]], [pkgs[0], pkgs[8]], [pkgs[4], pkgs[8]], [pkgs[6], pkgs[8]], [pkgs[7], pkgs[8]], [pkgs[9], pkgs[8]], [pkgs[5], pkgs[3]], [pkgs[6], pkgs[3]]]);

console.log(sortedPkgs.reverse());
//# sourceMappingURL=test.js.map