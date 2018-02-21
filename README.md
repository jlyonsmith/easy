# Snap: Node Project Build & Release Manager

A tool that makes building, testing, starting and releasing multi-package NodeJS projects a snap!  

Snap is an _opinionated_ tool for managing a NodeJS project tree.  It is most useful if your development environment:

- Uses [npm](http://npmjs.org) as the [NodeJS](http://nodejs.org) package manager
- Git to manage your source code
- If macOS, uses [iTerm2](https://www.iterm2.com/) as a scriptable replacement for the macOS Terminal app
- Uses my [stampver](https://www.npmjs.com/package/stampver) tool to manage your [semantic versioning](https://semver.org/)

You don't _have_ to use any or all of the above, but if you _do_ then `snap-tool` is the package for you!

## Installation

Install the package globally or use `npx` to run the latest version:

```
npm install -g snap-tool
snap help
```
or:

```
npx snap-tool help
```

## Build, test, update, install &amp; clean

These commands are all the same in that they don't take any parameters.  Use them like this:

```
snap build
snap test
snap update
snap install
snap clean
```

Each command will search recursively through your project tree looking for `package.json` files to process.  They each ignore `node_modules` directories.

## Starting stuff

It's common to have a NodeJS based product comprised of a website, a server and perhaps mobile apps.  You can run everything at once just typing:

```
snap start
```

Snap is also intended to be used with NodeJS servers consisting of multiple _actor_ services (or node sub-processes.)  If this is your system and you want to start the individual actors instead of the main (typically monitoring or watchdog) process use:

```
snap start --actors
```

Either way, `snap` will start each process using a new iTerm2 console so that you can shut down your entire product by simply closing down the iTerm2 window.

## Release stuff

Finally, when you are ready to ship your product `snap` is there to help.  Simply run the `release` command and everything is done for you, including adding a tag so your GitHub repository shows a new release.

The tool uses `stampver` to update version information for the build.  Just tell it which part of the version to update with `--patch`, `--minor` or `--major`.

If you add the `--npm` it will push the build to [npm](http://npmjs.org), but you must have already set up your credentials for doing so with `npm publish`.
