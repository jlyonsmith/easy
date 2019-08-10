import { EasyTool } from "./EasyTool"

let container = null

beforeEach(() => {
  container = {
    toolName: "easy",
    log: {
      info: jest.fn(),
      warning: jest.fn(),
      error: jest.fn(),
    },
  }
})

const getOutput = (fn) => {
  const calls = fn.mock.calls

  return calls.length > 0 && calls[0].length > 0 ? calls[0][0] : ""
}

test("--help", async () => {
  const tool = new EasyTool(container)
  const exitCode = await tool.run(["--help"])

  expect(exitCode).toBe(0)
  expect(getOutput(container.log.info)).toEqual(
    expect.stringContaining("--help")
  )
})

test("--version", async () => {
  const tool = new EasyTool(container)
  const exitCode = await tool.run(["--version"])

  expect(exitCode).toBe(0)
  expect(getOutput(container.log.info)).toEqual(
    expect.stringMatching(/\d\.\d\.\d/)
  )
})
