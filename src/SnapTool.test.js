import { SnapTool } from "./SnapTool"
import tmp from "tmp"
import fs from "fs"
import util from "util"

let tmpDirObj = null

beforeAll(() => {
  tmpDirObj = tmp.dirSync()
})

afterAll(() => {
  if (tmpDirObj) {
    tmpDirObj.removeCallback()
  }
})

function getMockLog() {
  return {
    info: jest.fn(),
    warning: jest.fn(),
    error: jest.fn(),
  }
}

function getOutput(fn) {
  const calls = fn.mock.calls
  if (calls.length > 0 && calls[0].length > 0) {
    return calls[0][0]
  } else {
    return ""
  }
}

test("--help", async (done) => {
  const mockLog = getMockLog()
  const tool = new SnapTool("snap", mockLog)
  const exitCode = await tool.run(["--help"])

  expect(exitCode).toBe(0)
  expect(getOutput(mockLog.info)).toEqual(expect.stringContaining("--help"))
  done()
})

test("--version", async (done) => {
  const mockLog = getMockLog()
  const tool = new SnapTool("snap", mockLog)
  const exitCode = await tool.run(["--version"])

  expect(exitCode).toBe(0)
  expect(getOutput(mockLog.info)).toEqual(expect.stringMatching(/\d\.\d\.\d/))
  done()
})
