# Easy: Node Build & Release Tool

[![code style: prettier](https://img.shields.io/badge/code_style-prettier-ff69b4.svg?style=flat-square)](https://github.com/prettier/prettier)

A tool that makes building, testing, starting, deploying and releasing multi-package NodeJS projects **easy**!

`easy` is an opinionated tool for managing a NodeJS project tree. It assumes your development environment uses:

- [npm](http://npmjs.org) as the [NodeJS](http://nodejs.org) package manager
- [git](https://git-scm.com/) to manage your source code
- If on macOS, [iTerm2](https://www.iterm2.com/) as a scriptable replacement for the macOS Terminal app
- [stampver](https://www.npmjs.com/package/stampver) to manage your [semantic versioning](https://semver.org/)
- An `actor` naming convention for node sub-processes.

If you don't use all of the above, then `easy` is probably not going to be that helpful too you. Told you it was opinionated!

## Installation

Install the package globally or use `npx` to run the latest version:

```sh
npm install -g @johnls/easy
easy --help
```

or:

```sh
npx @johnls/easy --help
```

## Build

To build all projects recursively use:

```sh
easy build
```

You can also specify `--install` and `--clean` with this command.

## Install

To install all `npm` packages recursively use:

```sh
easy install
```

If you specify `--clean` it will perform the `clean` command before installation.

## Clean

To recursively clean out all `node_modules`, `dist`, `build` and `package-lock.json` files use:

```sh
easy clean
```

## Test

To run all tests recursively use:

```sh
easy test
```

Each command will search recursively through your project tree looking for `package.json` files to process. They each ignore `node_modules` directories.

## Start

It's common to have a NodeJS based product comprised of a website, a server and perhaps mobile apps. `easy` will run all the `start` scripts recursively with:

```sh
easy start
```

Easy is also intended to be used with NodeJS servers consisting of multiple _actor_ services (or node sub-processes.) These actors processes have `script` names that start with `actor:`.

```sh
easy start --actors
```

If `easy` finds `actor:` entries, it will start each actor process using a new iTerm2 tab in the same window so that you can shut down your entire product with one click. For that `package.json` it will not run the `start` script. Very handy for local testing.

## Release

The `release` command is used to create a new tested and tagged release in Git.

The tool uses `stampver` to update version information for the build. Just tell it which part of the version to update with `patch`, `minor` or `major`.

If you add the `--deploy` it will run `npm run deploy` to run the `deploy` script. This can be whatever you want. For example, publishing to `npm` it would be done with `npm publish`. For provisioning using Ansible, it might run `ansible-playbook`.

## Deploy

The `deploy` command just runs `npm run deploy`. Simple.

## Rollback

To quickly rollback the current `HEAD` of all branches to the tag prior to the current tag.
