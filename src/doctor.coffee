_ = require 'underscore'
SRPClass = require './SRPClass'
fs = require 'fs-extra'
path = require 'path'
watch = require 'watch'
errno = require 'errno'
async = require 'async'
exec = require('child_process').exec
mv = require 'mv'
FilesystemError = errno.custom.FilesystemError

customFSError = (code, path) ->
	cause = _.clone errno.code[code] or errno.code.UNKNOWN
	if path then cause.path = path
	return new FilesystemError "", cause

class Doctor extends SRPClass
	constructor: (folder, options) ->
		@options = _.defaults options or {},
			key_sep: "/"

		@location = path.resolve process.cwd(), folder
		@tree = {}
		@write_cache = {}
		@watchrs = []

		# Call watchrs on change
		@on "change", (k, c, p) ->
			_.each @watchrs, (w) =>
				keys =  if _.isArray(w.match) then _.map(w.match, @_path.bind(@)) else @match(w.match)
				if _.contains(keys, k) then w.callback.call(null, k, c, p)

		# Watch the filesystem
		watch_cb = (f, curr, prev) =>
			if typeof f is "object" and prev is null and curr is null then @emit "ready"
			else
				k = f.replace @location, ""
				@tree[k] = curr
				@emit "change", k, curr, prev

		# Create the folder if it doesn't exist
		fs.mkdirs @location, (err) =>
			if err then @emit "error", err
			
			# Refresh the tree and then watch it
			else @refresh () =>
				watch.watchTree @location, watch_cb

	get: (file, cb) ->
		file = @_path file
		stat = @_stat file
		fp = @_full_path file

		unless stat
			if _.isFunction(cb) then cb customFSError "ENOENT"
			return undefined
		else if stat.isDirectory()
			files = @match file + @options.key_sep + "*"
			if _.isFunction(cb) then cb null, files
			return files
		else if stat.isFile()
			fstream = fs.createReadStream fp
			unless _.isFunction(cb) then return fstream

			cb = _.once cb
			buf = null

			fstream.on "data", (data) ->
				unless Buffer.isBuffer(buf) then buf = data
				else Buffer.concat [ buf, data ]

			fstream.on "close", () -> cb null, buf
			fstream.on "error", (err) -> cb err

	getSync: (file) ->
		file = @_path file
		stat = @_stat file
		fp = @_full_path file
		
		unless stat then return undefined
		else if stat.isDirectory() then return @match file + @options.key_sep + "*"
		else if stat.isFile() then return fs.readFileSync fp

	set: (file, value, cb) ->
		file = @_path file
		stat = @_stat file
		fp = @_full_path file
		if _.isString(value) then value = new Buffer(value)
		
		# Is buffer? must be a file
		if Buffer.isBuffer(value)
			# Destroy cached filestream
			if _.has(@write_cache, file) then delete @write_cache[file]

			# No callback? cache and return stream
			# Watch out! The internal tree isn't updated yet (and won't be for a while)
			# Also, if the parent folder doesn't exist, this will error up...
			unless _.isFunction(cb)
				fstream = fs.createWriteStream fp
				fstream.write(value)
				@write_cache[file] = fstream
				return fstream
			
			# Otherwise create needed folders, write and close
			else
				cb = _.once cb
				fs.mkdirs path.dirname(fp), (err) =>
					if err then return cb err
					fstream = fs.createWriteStream fp
					
					fstream.on "close", () =>
						# Refresh tree when done
						@refresh cb

					fstream.on "error", (err) -> cb err
					fstream.end(value)

		# Is object or array? must want a folder
		else if _.isObject(value)
			ccb = (err) =>
				if err then cb err
				else @refresh cb

			# Make the folder if it doesn't exist
			fs.mkdirs fp, (err) =>
				if err then return ccb err
				
				# No contents, return
				unless _.size(value) then return ccb null
				files = if _.isArray(value) then value else _.keys(value)
				
				# Is array? create files
				async.each(files, (key, callback) =>
					data = if _.isArray(value) then "" else value[key]
					key = path.join file, key
					@set key, data, callback
				, ccb)
		else
			err = new Error "Expecting string, buffer, array or object."
			if _.isFunction(cb) then cb err
			else @emit "error", err

	setSync: (file, value) ->
		file = @_path file
		stat = @_stat file
		fp = @_full_path file
		if _.isString(value) then value = new Buffer(value)

		# Is buffer? must be a file
		if Buffer.isBuffer(value)
			# First create the needed folders
			fs.mkdirsSync path.dirname(fp)

			# Then create/write the file
			fs.outputFileSync fp, value

			# Lastly update stats
			@tree[file] = fs.statSync fp

		# Is object or array? must want a folder
		else if _.isObject(value)
			# Make the folder if it doesn't exist
			fs.mkdirsSync fp

			# Update stats for the new folder
			@tree[file] = fs.statSync fp

			# No contents, return
			unless _.size(value) then return
				
			# Is array?
			else if _.isArray(value) then _.each value, (key) =>
				nkey = path.join file, key
				@setSync nkey, ""
				
			# Is Object?
			else _.each value, (data, key) =>
				nkey = path.join file, key
				@setSync nkey, data

		else throw new Error "Set method expects string, buffer, array or object."

	remove: (file, cb) ->
		fs.remove @_full_path(file), (err) =>
			if _.isFunction(cb)
				if err then cb err
				else @refresh cb
			else if err then @emit "error", err

	removeSync: (file) ->
		fs.removeSync @_full_path(file)
		if _.has(@tree, file) then delete @tree[file]

	test: (file) ->
		return if @_stat(file) then true else false

	has: Doctor.prototype.test
	exists: Doctor.prototype.test

	match: (file) ->
		stars = /([\\])?(\*\*?)/i
		one = "([^#{@options.key_sep}]*)"
		two = "(.*)"

		rmatch = (str) ->
			m = stars.exec(str)
			unless m then return str
			
			a = str.slice 0, m.index

			b = if m[1] then m[2]
			else if m[2] is "*" then one
			else if m[2] is "**" then two
			else m[0]

			c = rmatch(str.slice(m.index + m[0].length))

			return a + b + c

		if _.isString(file) then file = new RegExp "^#{rmatch(@_path(file))}$"

		if !_.isRegExp(file)
			@emit "error", new Error("Expecting string or regex.")
			return []

		return _.chain(@tree).keys().filter((k) -> return k.match(file)).value()
	
	each: (file, it, cb) ->
		if _.isFunction(file) and !it then [it, file] = [file, "**"]
		keys =  if _.isArray(file) then _.map(file, @_path.bind(@)) else @match(file)
		
		async.eachSeries(keys, (f, next) =>
			it.call(null, f, @_stat(f), next)
		, (err) =>
			if _.isFunction(cb) then cb(err)
			else if err then @emit "error", err
		)

	eachSync: (file, it) ->
		if _.isFunction(file) and !it then [it, file] = [file, "**"]
		keys =  if _.isArray(file) then _.map(file, @_path.bind(@)) else @match(file)
		_.each keys, (f) =>
			it.call(null, f, @_stat(f))

	replace: (file, it, cb) ->
		@each(file, (f, stat, follow) =>
			next = (val) =>
				if _.has(@write_cache, f) then delete @write_cache[f]
				@set f, val, follow

			if _.isFunction(it) then it.call null, f, stat, next
			else next(it)
		, (err) =>
			if _.isFunction(cb) then cb(err)
			else if err then @emit "error", err
		)

	replaceSync: (file, it) ->
		@eachSync file, (f, stat) =>
			if _.isFunction(it) then @set f, it.call(null, f, stat)
			else @set f, it
	
	watch: (file, cb) ->
		if _.isFunction(file) and !cb then [cb, file] = [file, "**"]
		@watchrs.push({ match: file, callback: cb });

	unwatch: (file, cb) ->
		m = { match: file, callback: cb }
		_.some @watchrs, (o, k) =>
			if _.isEqual(o, m)
				delete @watchrs[k]
				return true

	find: (value, cb) ->
		@search value, (files) ->
			cb if _.size(files) then files[0] else null

	search: (value, cb) ->
		exec "find . | xargs grep '#{value}' -isl", {
			timeout: 30 * 1000, # 30 seconds
			cwd: @location
		}, (err, stdout, stdin) =>
			cb _.chain(stdout.split('\n')).compact().map((p) ->
				return if p.substr(0,1) is "." then p.substr(1) else p
			).value()

	save: (cb) ->
		async.each(@write_cache, (stream, next) ->
			if stream.writable
				stream.on "close", () -> next()
				stream.on "error", (err) -> next(err)
				stream.end()
		, (err) ->
			if err then cb(err)
			else
				@write_cache = {}
				@refresh (err) => # refresh tree
					if err then cb err
					else
						@emit "save"
						cb() 
		)
	
	load: (from, to, cb) ->
		if _.isFunction(to) and !cb then [cb, to] = [to, path.basename(from)]
		fs.copy from, path.resolve(@location, to), (err) ->
			if err then cb(err)
			else @refresh (err) => # refresh tree
				if err then cb err
				else
					@emit "load", from, to
					cb() 

	copy: Doctor.prototype.load

	move: (file, to, cb) ->
		to = path.resolve @location, to
		mv @_full_path(file), to, (err) ->
			if err then cb(err)
			else @refresh cb # refresh tree

	refresh: (cb) ->
		@tree = {} # Reset tree

		exec "find .", {
			timeout: 30 * 1000, # 30 seconds
			cwd: @location
		}, (err, stdout, stdin) =>
			files = _.chain(stdout.split('\n')).compact().map((p) ->
				p = if p.substr(0, 1) is "." then p.substr(1) else p
				p = if p.substr(0, 1) isnt "/" then "/" + p else p
				return p
			).value()

			async.each(files, (file, callback) =>
				fs.stat @_full_path(file), (err, stat) =>
					if err then callback err
					else
						@tree[file] = stat
						callback()
			, (err) =>
				if _.isFunction(cb) then cb(err)
				else if err then @emit "error", err
			)

	_path: (file) ->
		unless file then file = ""
		return "/" + @_sepPath(file).join(path.sep)

	_full_path: (file) ->
		return path.join @location, @_path file

	_stat: (file) ->
		return @tree[@_path(file)]

module.exports = Doctor