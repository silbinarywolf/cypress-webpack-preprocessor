const cloneDeep = require('lodash.clonedeep')
const path = require('path')
const webpack = require('webpack')
const log = require('debug')('cypress:webpack')
const fs = require('fs');

const createDeferred = require('./deferred')

const bundles = {}

// by default, we transform JavaScript supported by @babel/preset-env
const defaultBabelLoaderRules = () => {
	return [
		{
			test: /\.js?$/,
			exclude: [/node_modules/],
			use: [
				{
					loader: require.resolve('babel-loader'),
					options: {
						presets: [require.resolve('@babel/preset-env')],
					},
				},
			],
		},
	]
}

// we don't automatically load the rules, so that the babel dependencies are
// not required if a user passes in their own configuration
const defaultOptions = {
	webpackOptions: {
		module: {
			rules: [],
		},
	},
	watchOptions: {},
}

let hasCompiled = false;

const preprocessorFullBuild = (file) => {

}


const preprocessorWatch = (file) => {
	const filePath = file.filePath
	log('get', filePath)

	// since this function can get called multiple times with the same
	// filePath, we return the cached bundle promise if we already have one
	// since we don't want or need to re-initiate webpack for it
	if (bundles[filePath]) {
		log(`already have bundle for ${filePath}`)
		return bundles[filePath]
	}

	// user can override the default options
	let webpackOptions = Object.assign({}, defaultOptions.webpackOptions, options.webpackOptions)
	// here is where we load the default rules if the user has not passed
	// in their own configuration
	if (webpackOptions.module.rules === defaultOptions.webpackOptions) {
		webpackOptions.module.rules = defaultBabelLoaderRules()
	}
	let watchOptions = Object.assign({}, defaultOptions.watchOptions, options.watchOptions)

	// we're provided a default output path that lives alongside Cypress's
	// app data files so we don't have to worry about where to put the bundled
	// file on disk
	const outputPath = file.outputPath

	// we need to set entry and output
	webpackOptions = Object.assign(webpackOptions, {
		entry: filePath,
		output: {
			path: path.dirname(outputPath),
			filename: path.basename(outputPath),
		},
	})

	log(`input: ${filePath}`)
	log(`output: ${outputPath}`)

	const compiler = webpack(webpackOptions)

	// we keep a reference to the latest bundle in this scope
	// it's a deferred object that will be resolved or rejected in
	// the `handle` function below and its promise is what is ultimately
	// returned from this function
	let latestBundle = createDeferred()
	// cache the bundle promise, so it can be returned if this function
	// is invoked again with the same filePath
	bundles[filePath] = latestBundle.promise

	const rejectWithErr = (err) => {
		err.filePath = filePath
		// backup the original stack before it's potentially modified by bluebird
		err.originalStack = err.stack
		log(`errored bundling ${outputPath}`, err)
		latestBundle.reject(err)
	}

	// this function is called when bundling is finished, once at the start
	// and, if watching, each time watching triggers a re-bundle
	const handle = (err, stats) => {
		if (err) {
			return rejectWithErr(err)
		}

		const jsonStats = stats.toJson()

		if (stats.hasErrors()) {
			err = new Error('Webpack Compilation Error')
			err.stack = jsonStats.errors.join('\n\n')
			return rejectWithErr(err)
		}

		// these stats are really only useful for debugging
		if (jsonStats.warnings.length > 0) {
			log(`warnings for ${outputPath}`)
			log(jsonStats.warnings)
		}

		log('finished bundling', outputPath)
		// resolve with the outputPath so Cypress knows where to serve
		// the file from
		latestBundle.resolve(outputPath)
	}

	// this event is triggered when watching and a file is saved
	const plugin = { name: 'CypressWebpackPreprocessor' }

	const onCompile = () => {
		log('compile', filePath)
		// we overwrite the latest bundle, so that a new call to this function
		// returns a promise that resolves when the bundling is finished
		latestBundle = createDeferred()
		bundles[filePath] = latestBundle.promise.tap(() => {
			log('- compile finished for', filePath)
			// when the bundling is finished, emit 'rerun' to let Cypress
			// know to rerun the spec
			file.emit('rerun')
		})
	}

	// when we should watch, we hook into the 'compile' hook so we know when
	// to rerun the tests
	if (file.shouldWatch) {
		log('watching')

		if (compiler.hooks) {
			compiler.hooks.compile.tap(plugin, onCompile)
		} else {
			compiler.plugin('compile', onCompile)
		}
	}

	const bundler = file.shouldWatch ? compiler.watch(watchOptions, handle) : compiler.run(handle)

	// when the spec or project is closed, we need to clean up the cached
	// bundle promise and stop the watcher via `bundler.close()`
	file.on('close', () => {
		log('close', filePath)
		delete bundles[filePath]

		if (file.shouldWatch) {
			bundler.close()
		}
	})

	// return the promise, which will resolve with the outputPath or reject
	// with any error encountered
	return bundles[filePath]
}

// export a function that returns another function, making it easy for users
// to configure like so:
//
// on('file:preprocessor', webpack(options))
//
const preprocessor = (options = {}) => {
	log('user options:', options)

	// we return function that accepts the arguments provided by
	// the event 'file:preprocessor'
	//
	// this function will get called for the support file when a project is loaded
	// (if the support file is not disabled)
	// it will also get called for a spec file when that spec is requested by
	// the Cypress runner
	//
	// when running in the GUI, it will likely get called multiple times
	// with the same filePath, as the user could re-run the tests, causing
	// the supported file and spec file to be requested again
	return (file) => {
		const filePath = file.filePath

		log('get', filePath)

		// since this function can get called multiple times with the same
		// filePath, we return the cached bundle promise if we already have one
		// since we don't want or need to re-initiate webpack for it
		if (bundles[filePath]) {
			log(`already have bundle for ${filePath}`)
			return bundles[filePath]
		}

		// Determine where the "cypress" folder is from the test
		let cypressFolder = '';
		const dirParts = filePath.split(path.sep);
		for (let i = dirParts.length - 1; i >= 0; i--) {
				const dirPart = dirParts[i];
				if (dirPart === 'cypress') {
						// Built directory name from parts
						for (let j = 0; j < dirParts.length; j++) {
								if (cypressFolder !== '') {
										cypressFolder += path.sep;
								}
								cypressFolder += dirParts[j];
						}
				}
		}
		if (cypressFolder === '') {
				throw new Error('Cannot determine "cypress" folder from spec filepath.');
		}

		// NOTE(Jake): 2019-04-03
		// Hack! Since Cypress doesn't give an array of all test/spec files at once,
		// we need to retrieve them ourselves.
		const entryMap = {};
		let specFiles = [];
		filewalker(cypressFolder + path.sep + 'integration', function(err, specFilePath){
				if(err){
						throw err;
				}
				const ext = path.extname(specFilePath);
				if (ext === '.js' ||
						ext === '.jsx' ||
						ext === '.ts' ||
						ext === '.tsx') {
						entryMap[path.basename(specFilePath)] = specFilePath;
						specFiles.push(specFilePath);
				}
		});
		if (specFiles.length === 0) {
				throw new Error('Cannot find any spec files in: ' + cypressFolder);
		}

		// user can override the default options
		let webpackOptions = Object.assign({}, defaultOptions.webpackOptions, options.webpackOptions)
		// here is where we load the default rules if the user has not passed
		// in their own configuration
		if (webpackOptions.module.rules === defaultOptions.webpackOptions) {
			webpackOptions.module.rules = defaultBabelLoaderRules()
		}
		let watchOptions = Object.assign({}, defaultOptions.watchOptions, options.watchOptions)

		// we're provided a default output path that lives alongside Cypress's
		// app data files so we don't have to worry about where to put the bundled
		// file on disk
		const outputPath = file.outputPath

		let compiler;
		let latestBundle;

		// we need to set entry and output
		webpackOptions = Object.assign(webpackOptions, {
			entry: entryMap,
			output: {
				path: path.dirname(outputPath),
				filename: (chunkData) => {
						return chunkData.chunk.name;
				}
			},
		})
		log(`input: ${filePath}`)
		log(`output: ${outputPath}`)

		compiler = webpack(webpackOptions)

		// we keep a reference to the latest bundle in this scope
		// it's a deferred object that will be resolved or rejected in
		// the `handle` function below and its promise is what is ultimately
		// returned from this function
		latestBundle = createDeferred()
		// cache the bundle promise, so it can be returned if this function
		// is invoked again with the same filePath
		for (let specFilePath of specFiles) {
				bundles[specFilePath] = latestBundle.promise;
		}

		const rejectWithErr = (err) => {
			err.filePath = filePath
			// backup the original stack before it's potentially modified by bluebird
			err.originalStack = err.stack
			log(`errored bundling ${outputPath}`, err)
			latestBundle.reject(err)
		}

		// this function is called when bundling is finished, once at the start
		// and, if watching, each time watching triggers a re-bundle
		const onCompileFinished = (err, stats) => {
			if (err) {
				return rejectWithErr(err)
			}

			const jsonStats = stats.toJson()

			if (stats.hasErrors()) {
				err = new Error('Webpack Compilation Error')
				err.stack = jsonStats.errors.join('\n\n')
				return rejectWithErr(err)
			}

			// these stats are really only useful for debugging
			if (jsonStats.warnings.length > 0) {
				log(`warnings for ${outputPath}`)
				log(jsonStats.warnings)
			}

			log('finished bundling', outputPath)
			// resolve with the outputPath so Cypress knows where to serve
			// the file from
			//or (let specFilePath of specFiles) {
				//  bundles[specFilePath].resolve()
			//}
			latestBundle.resolve(outputPath)
		}

		// this event is triggered when watching and a file is saved
		const plugin = { name: 'CypressWebpackPreprocessor' }

		const onWatchCompile = () => {
			log('compile', filePath)
			// we overwrite the latest bundle, so that a new call to this function
			// returns a promise that resolves when the bundling is finished
			latestBundle = createDeferred()
			bundles[filePath] = latestBundle.promise.tap(() => {
				log('- compile finished for', filePath)
				// when the bundling is finished, emit 'rerun' to let Cypress
				// know to rerun the spec
				file.emit('rerun')
			})
		}

		// when we should watch, we hook into the 'compile' hook so we know when
		// to rerun the tests
		if (file.shouldWatch) {
			log('watching')

			if (compiler.hooks) {
				compiler.hooks.compile.tap(plugin, onWatchCompile)
			} else {
				compiler.plugin('compile', onWatchCompile)
			}
		}

		const bundler = file.shouldWatch ? compiler.watch(watchOptions, onCompileFinished) : compiler.run(onCompileFinished)

		// when the spec or project is closed, we need to clean up the cached
		// bundle promise and stop the watcher via `bundler.close()`
		file.on('close', () => {
			log('close', filePath)
			delete bundles[filePath]

			if (file.shouldWatch) {
				bundler.close()
			}
		})

		// return the promise, which will resolve with the outputPath or reject
		// with any error encountered
		return bundles[filePath]
	}
}

// provide a clone of the default options, making sure to lazy-load
// babel dependencies so that they aren't required unless the user
// utilizes them
Object.defineProperty(preprocessor, 'defaultOptions', {
	get () {
		const clonedDefaults = cloneDeep(defaultOptions)
		clonedDefaults.webpackOptions.module.rules = defaultBabelLoaderRules()
		return clonedDefaults
	},
})

/**
 * Explores recursively a directory and returns all the filepaths and folderpaths in the callback.
 * 
 * @see http://stackoverflow.com/a/5827895/4241030
 * @param {String} dir 
 * @param {Function} done 
 */
function filewalker(dir, done) {
		let results = [];

		fs.readdir(dir, function(err, list) {
				if (err) return done(err);

				var pending = list.length;

				if (!pending) return done(null, results);

				list.forEach(function(file){
						file = path.resolve(dir, file);

						fs.stat(file, function(err, stat){
								// If directory, execute a recursive call
								if (stat && stat.isDirectory()) {
										// Add directory to array [comment if you need to remove the directories from the array]
										results.push(file);

										filewalker(file, function(err, res){
												results = results.concat(res);
												if (!--pending) done(null, results);
										});
								} else {
										results.push(file);

										if (!--pending) done(null, results);
								}
						});
				});
		});
};

module.exports = preprocessor
