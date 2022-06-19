import fs from "fs/promises"
import fsSync from "fs"
import path from "path"
import util from "util"
import open from "open"
import Server from "./server.js"
import * as childProcess from "child_process"
import {promisify} from "util"
import {require, appPath, getOptions} from "./utils.js"

const exec = promisify(childProcess.exec)

// Acquire command line p
let options = getOptions()
let server: Server = null

/**
 * Starts the viewer
 */
async function run(): Promise<void> {
	// Show help if no cli parameters specified
	if(Object.keys(options).length == 0 || "help" in options) {
		// Retrieve parameter names and descriptions from file
		let commandLineParameters: {[key: string]: string} = require("./data/clip.json")
		let names = Object.keys(commandLineParameters).sort()
		let width = Math.max(...names.map(name => name.length))

		for(let name of names)
			console.log(`-${name.padEnd(width)}\t${commandLineParameters[name]}`)
	} else if("parser" in options) { // Parse input
		if("display" in options) {
			// Start the viewer server
			let port = parseInt(options.port)

			server = new Server(port ? port : undefined, async () => {
				console.log(`Started viewer on port ${server.port}`)

				if(!port) // If the port was not specified, open the server in the browser
					await open(`http://localhost:${server.port}`)
			})

			// Generate output for new connections
			server.on("connected", () => generate())
		} else // Generate output immediately
			generate()

		// Watch files to regenerate output and exit on keypress
		if("watch" in options) {
			let directories = [
				options.parser,
				options.srcPath
			].filter(d => d != null)

			// Regenerate output when parser files or source file change
			for(let directory of directories)
				fsSync.watch(
					directory,
					{recursive: true},
					() => generate()
				)

			// Reload viewer page since source changed
			fsSync.watch(
				appPath,
				{recursive: true},
				() => server.send("reload")
			)

			// Exit on any key press
			process.stdin.setRawMode(true)
			process.stdin.resume()
			process.stdin.on("data", () => process.exit())
		}
	}
}

/**
 * Generate parser output
 */
async function generate(): Promise<void> {
	let args: string[] = []

	// Add lua executable name
	if("lua" in options)
		args.push(options.lua)
	else
		throw new Error("No Lua runtime specified")

	// Add parser main file path
	if("parser" in options) {
		args.push(path.join("src", "main.lua"))
		args.push("-parse")
	} else
		throw new Error("No parser directory specified")

	// Add optional entry rule
	if("entry" in options)
		args.push(`-entry=${options.entry}`)

	// Add source code to parse
	if("src" in options)
		args.push(`-src=${options.src}`)
	else if("srcPath" in options) {
		try {
			let data = await fs.readFile(options.srcPath)
			let src = data.toString().trim()

			if(!src)
				return

			args.push(`-src=${JSON.stringify(src)}`)
		} catch(e) {
			console.log(e instanceof Error ? e.message : e)
			return
		}
	} else
		throw new Error("No source specified")

	let command = args.join(" ")
	let outputText: string, errorText: string

	try {
		// Run the parser in its directory
		let {stdout, stderr} = await exec(command, {cwd: options.parser})
		outputText = stdout.trim()
		errorText = stderr.trim()
	} catch(e) {
		if(e instanceof Error)
			console.error(e.message)

		return
	}

	// Convert last line of parser output to JSON ast
	if("ast" in options) {
		let lines = outputText.split(/\r?\n/)
		let ast: object

		try {
			ast = JSON.parse(lines.at(-1))
		} catch(e) {
			if(e instanceof Error)
				console.log(`Last line of output is not valid JSON:\n\t${lines.join("\n\t")}`)

			return
		}

		// Print syntax tree to console
		if("print" in options)
			console.log(`\n${util.inspect(ast, {
				showHidden: true,
				depth: null,
				colors: true
			})}`)

		// Update viewer with new ast
		if("display" in options)
			server?.send("display", ast)
	}

	// Display all output to console
	if("log" in options) {
		let text = `${outputText}\n\n${errorText}`.trim()

		if(text)
			console.log(`\n${text}`)
	}
}

// Start the viewer
run()