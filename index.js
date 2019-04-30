const cloneDeep = require('lodash.clonedeep')
const path = require('path')
const fs = require('fs')
const webpack = require('webpack')
const log = require('debug')('cypress:webpack')

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
	const filePath = file.filePath;

	// when the spec or project is closed, we need to clean up the cached
	// bundle promise and stop the watcher via `bundler.close()`
	/*file.on('close', () => {
	  log('close', filePath)
	  delete bundles[filePath]

	  //if (file.shouldWatch) {
		//bundler.close()
	  //}
	})*/

	const fileBundle = '';

	//
	let testFiles = [];
	{
		let inputPath = '';
		const dirParts = filePath.split(path.sep);
		for (let i = dirParts.length - 1; i >= 0; i--) {
			const dirPart = dirParts[i];
			if (dirPart === 'integration') {
				inputPath = dirParts.slice(0, i+1).join(path.sep);
				break
			}
		}
		
		testFiles = [
			'C:\\build\\devel\\srcjava\\AcurityWeb\\src\\main\\javascript\\cypress\\integration\\unit\\datepicker.test.ts',
			'C:\\build\\devel\\srcjava\\AcurityWeb\\src\\main\\javascript\\cypress\\integration\\unit\\address.test.ts',
			'C:\\build\\devel\\srcjava\\AcurityWeb\\src\\main\\javascript\\cypress\\integration\\unit\\autocomplete.test.ts',
			'C:\\build\\devel\\srcjava\\AcurityWeb\\src\\main\\javascript\\cypress\\integration\\unit\\category-description.test.ts',
			'C:\\build\\devel\\srcjava\\AcurityWeb\\src\\main\\javascript\\cypress\\integration\\unit\\field-holder.test.ts',
			'C:\\build\\devel\\srcjava\\AcurityWeb\\src\\main\\javascript\\cypress\\integration\\unit\\search.test.ts',
			'C:\\build\\devel\\srcjava\\AcurityWeb\\src\\main\\javascript\\cypress\\integration\\unit\\text.test.ts',
			'C:\\build\\devel\\srcjava\\AcurityWeb\\src\\main\\javascript\\cypress\\support\\index.js',
		];
		/*if (inputPath !== '') {
			filewalker(inputPath, function(err, results) {
				testFiles = results;
			});
		}
		log('files', inputPath, testFiles);
		throw new Error(inputPath);*/
	}

	// we're provided a default output path that lives alongside Cypress's
	// app data files so we don't have to worry about where to put the bundled
	// file on disk
	let outputDir = path.dirname(file.outputPath);
	{
		const dirParts = outputDir.split(path.sep);
		for (let i = dirParts.length - 1; i >= 0; i--) {
			const dirPart = dirParts[i];
			if (dirPart === 'cypress') {
				outputDir = dirParts.slice(0, i+1).join(path.sep);
				break;
			}
		}
	}

	// since this function can get called multiple times with the same
	// filePath, we return the cached bundle promise if we already have one
	// since we don't want or need to re-initiate webpack for it
	if (bundles[filePath] !== undefined) {
	  log(`already have bundle for ${filePath}`);
	  return bundles[filePath].promise;
	} else {
		log(`no bundle ${filePath}`)
	}

	log('compile test files', testFiles)

	// If bundles is already populated but didn't match the current file
	// some sort of error has occurred.
	//for (let testFile in bundles) {
	//	throw new Error(`already generated bundles previously.`);
	//}

	/*if (file.shouldWatch) {
		log('watching')

		if (compiler.hooks) {
			compiler.hooks.compile.tap(plugin, onCompile)
		} else {
			compiler.plugin('compile', onCompile)
		}
		const watchOptions = Object.assign({}, defaultOptions.watchOptions, options.watchOptions)
		compiler.watch(watchOptions, handle)
		return;
	}*/

	// user can override the default options
	let webpackOptions = Object.assign({}, defaultOptions.webpackOptions, options.webpackOptions)
	// here is where we load the default rules if the user has not passed
	// in their own configuration
	if (webpackOptions.module.rules === defaultOptions.webpackOptions) {
	  webpackOptions.module.rules = defaultBabelLoaderRules()
	}

	// we need to set entry and output
	webpackOptions = Object.assign(webpackOptions, {
	  entry: {},
	  output: {
		path: outputDir, // path.dirname(outputPath),
		chunkFilename: '[name].chunk.js',
		filename: (chunkData) => {
			return chunkData.chunk.name;
			//throw new Error('filename: ' + chunkData.chunk.name + ', ' + path.basename(outputPath) + ', ' + path.dirname(outputPath));
			//return chunkData.chunk.name === 'main' ? '[name].js': '[name]/[name].js';
		}
	  },
	  /* optimization: {
		splitChunks: {
		  cacheGroups: {},
		},
	  },*/
	//  optimization: {
   //  runtimeChunk: 'single'
  // }
/*	  optimization: {
			splitChunks: {
				cacheGroups: {
					vendors: {
						chunks: 'all',
						test: /[\\/]node_modules[\\/]/,
						priority: -10,
					},
					default: {
						minChunks: 1,
						priority: -20,
						reuseExistingChunk: true,
					}
				},
			},
		},*/
	})
	testFiles.forEach((testFile) => {
		const testFileKey = path.basename(testFile);
		webpackOptions.entry[testFileKey] = testFile;
		// https://github.com/webpack-contrib/mini-css-extract-plugin/issues/116#issuecomment-387278305
		/*webpackOptions.optimization.splitChunks.cacheGroups[testFileKey] = {
			test: testFile,
			name: testFileKey,
		};*/
		bundles[testFile] = createDeferred();
	})
	/*webpackOptions.optimization.splitChunks.cacheGroups['vendors'] = {
		test: /[\\/]node_modules[\\/]/,
        name: "vendors",
	};*/

	//log(`input: ${filePath}`)
	//log(`output: ${outputDir}`)

	const compiler = webpack(webpackOptions)

	// we keep a reference to the latest bundle in this scope
	// it's a deferred object that will be resolved or rejected in
	// the `handle` function below and its promise is what is ultimately
	// returned from this function
	//let latestBundle = createDeferred()

	// cache the bundle promise, so it can be returned if this function
	// is invoked again with the same filePath
	//bundles[filePath] = latestBundle.promise

	const rejectWithErr = (err) => {
	  err.filePath = filePath
	  // backup the original stack before it's potentially modified by bluebird
	  err.originalStack = err.stack
	  log(`errored bundling ${outputDir}`, err)
	  testFiles.forEach((testFile) => {
		for (let testFile in bundles) {
			if (bundles[testFile] !== undefined) {
				bundles[testFile].reject(err);
			}
		}
	  })
	}

	// this function is called when bundling is finished, once at the start
	// and, if watching, each time watching triggers a re-bundle
	const onBundleFinished = (err, stats) => {
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
		log(`warnings for ${outputDir}`)
		log(jsonStats.warnings)
	  }

	  // resolve with the outputPath so Cypress knows where to serve
	  // the file from
	  for (let testFile in bundles) {
		if (bundles[testFile] === undefined) {
			continue;
		}
		const outputPath = outputDir + path.sep + path.basename(testFile);
		if (!fs.existsSync(outputPath)) {
			throw new Error('Bundle file missing. Possible error with Webpack configuration.');
		}
		bundles[testFile].resolve(outputPath);
		log('bundle input:', testFile, '\noutput:', outputPath);
	  }

	  log('finished bundling')
	}

	// this event is triggered when watching and a file is saved
	const plugin = { name: 'CypressWebpackPreprocessor' }

	/*const onCompile = () => {
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
	}*/


	const bundler = compiler.run(onBundleFinished);

	// return the promise, which will resolve with the outputPath or reject
	// with any error encountered
	return bundles[filePath].promise
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
