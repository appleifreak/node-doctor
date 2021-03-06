// Generated by CoffeeScript 1.6.1
(function() {
  var Doctor, FilesystemError, SRPClass, async, customFSError, errno, exec, fs, mv, path, watch, _,
    __hasProp = {}.hasOwnProperty,
    __extends = function(child, parent) { for (var key in parent) { if (__hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; };

  _ = require('underscore');

  SRPClass = require('./SRPClass');

  fs = require('fs-extra');

  path = require('path');

  watch = require('watch');

  errno = require('errno');

  async = require('async');

  exec = require('child_process').exec;

  mv = require('mv');

  FilesystemError = errno.custom.FilesystemError;

  customFSError = function(code, path) {
    var cause;
    cause = _.clone(errno.code[code] || errno.code.UNKNOWN);
    if (path) {
      cause.path = path;
    }
    return new FilesystemError("", cause);
  };

  Doctor = (function(_super) {

    __extends(Doctor, _super);

    function Doctor(folder, options) {
      var watch_cb,
        _this = this;
      this.options = _.defaults(options || {}, {
        key_sep: "/"
      });
      this.location = path.resolve(process.cwd(), folder);
      this.tree = {};
      this.write_cache = {};
      this.watchrs = [];
      this.on("change", function(k, c, p) {
        var _this = this;
        return _.each(this.watchrs, function(w) {
          var keys;
          keys = _.isArray(w.match) ? _.map(w.match, _this._path.bind(_this)) : _this.match(w.match);
          if (_.contains(keys, k)) {
            return w.callback.call(null, k, c, p);
          }
        });
      });
      watch_cb = function(f, curr, prev) {
        var k;
        if (typeof f === "object" && prev === null && curr === null) {
          return _this.emit("ready");
        } else {
          k = f.replace(_this.location, "");
          _this.tree[k] = curr;
          return _this.emit("change", k, curr, prev);
        }
      };
      fs.mkdirs(this.location, function(err) {
        if (err) {
          return _this.emit("error", err);
        } else {
          return _this.refresh(function() {
            return watch.watchTree(_this.location, watch_cb);
          });
        }
      });
    }

    Doctor.prototype.get = function(file, cb) {
      var buf, files, fp, fstream, stat;
      file = this._path(file);
      stat = this._stat(file);
      fp = this._full_path(file);
      if (!stat) {
        if (_.isFunction(cb)) {
          cb(customFSError("ENOENT"));
        }
        return void 0;
      } else if (stat.isDirectory()) {
        files = this.match(file + this.options.key_sep + "*");
        if (_.isFunction(cb)) {
          cb(null, files);
        }
        return files;
      } else if (stat.isFile()) {
        fstream = fs.createReadStream(fp);
        if (!_.isFunction(cb)) {
          return fstream;
        }
        cb = _.once(cb);
        buf = null;
        fstream.on("data", function(data) {
          if (!Buffer.isBuffer(buf)) {
            return buf = data;
          } else {
            return Buffer.concat([buf, data]);
          }
        });
        fstream.on("close", function() {
          return cb(null, buf);
        });
        return fstream.on("error", function(err) {
          return cb(err);
        });
      }
    };

    Doctor.prototype.getSync = function(file) {
      var fp, stat;
      file = this._path(file);
      stat = this._stat(file);
      fp = this._full_path(file);
      if (!stat) {
        return void 0;
      } else if (stat.isDirectory()) {
        return this.match(file + this.options.key_sep + "*");
      } else if (stat.isFile()) {
        return fs.readFileSync(fp);
      }
    };

    Doctor.prototype.set = function(file, value, cb) {
      var ccb, err, fp, fstream, stat,
        _this = this;
      file = this._path(file);
      stat = this._stat(file);
      fp = this._full_path(file);
      if (_.isString(value)) {
        value = new Buffer(value);
      }
      if (Buffer.isBuffer(value)) {
        if (_.has(this.write_cache, file)) {
          delete this.write_cache[file];
        }
        if (!_.isFunction(cb)) {
          fstream = fs.createWriteStream(fp);
          fstream.write(value);
          this.write_cache[file] = fstream;
          return fstream;
        } else {
          cb = _.once(cb);
          return fs.mkdirs(path.dirname(fp), function(err) {
            if (err) {
              return cb(err);
            }
            fstream = fs.createWriteStream(fp);
            fstream.on("close", function() {
              return _this.refresh(cb);
            });
            fstream.on("error", function(err) {
              return cb(err);
            });
            return fstream.end(value);
          });
        }
      } else if (_.isObject(value)) {
        ccb = function(err) {
          if (err) {
            return cb(err);
          } else {
            return _this.refresh(cb);
          }
        };
        return fs.mkdirs(fp, function(err) {
          var files;
          if (err) {
            return ccb(err);
          }
          if (!_.size(value)) {
            return ccb(null);
          }
          files = _.isArray(value) ? value : _.keys(value);
          return async.each(files, function(key, callback) {
            var data;
            data = _.isArray(value) ? "" : value[key];
            key = path.join(file, key);
            return _this.set(key, data, callback);
          }, ccb);
        });
      } else {
        err = new Error("Expecting string, buffer, array or object.");
        if (_.isFunction(cb)) {
          return cb(err);
        } else {
          return this.emit("error", err);
        }
      }
    };

    Doctor.prototype.setSync = function(file, value) {
      var fp, stat,
        _this = this;
      file = this._path(file);
      stat = this._stat(file);
      fp = this._full_path(file);
      if (_.isString(value)) {
        value = new Buffer(value);
      }
      if (Buffer.isBuffer(value)) {
        fs.mkdirsSync(path.dirname(fp));
        fs.outputFileSync(fp, value);
        return this.tree[file] = fs.statSync(fp);
      } else if (_.isObject(value)) {
        fs.mkdirsSync(fp);
        this.tree[file] = fs.statSync(fp);
        if (!_.size(value)) {

        } else if (_.isArray(value)) {
          return _.each(value, function(key) {
            var nkey;
            nkey = path.join(file, key);
            return _this.setSync(nkey, "");
          });
        } else {
          return _.each(value, function(data, key) {
            var nkey;
            nkey = path.join(file, key);
            return _this.setSync(nkey, data);
          });
        }
      } else {
        throw new Error("Set method expects string, buffer, array or object.");
      }
    };

    Doctor.prototype.remove = function(file, cb) {
      var _this = this;
      return fs.remove(this._full_path(file), function(err) {
        if (_.isFunction(cb)) {
          if (err) {
            return cb(err);
          } else {
            return _this.refresh(cb);
          }
        } else if (err) {
          return _this.emit("error", err);
        }
      });
    };

    Doctor.prototype.removeSync = function(file) {
      fs.removeSync(this._full_path(file));
      if (_.has(this.tree, file)) {
        return delete this.tree[file];
      }
    };

    Doctor.prototype.test = function(file) {
      if (this._stat(file)) {
        return true;
      } else {
        return false;
      }
    };

    Doctor.prototype.has = Doctor.prototype.test;

    Doctor.prototype.exists = Doctor.prototype.test;

    Doctor.prototype.match = function(file) {
      var one, rmatch, stars, two;
      stars = /([\\])?(\*\*?)/i;
      one = "([^" + this.options.key_sep + "]*)";
      two = "(.*)";
      rmatch = function(str) {
        var a, b, c, m;
        m = stars.exec(str);
        if (!m) {
          return str;
        }
        a = str.slice(0, m.index);
        b = m[1] ? m[2] : m[2] === "*" ? one : m[2] === "**" ? two : m[0];
        c = rmatch(str.slice(m.index + m[0].length));
        return a + b + c;
      };
      if (_.isString(file)) {
        file = new RegExp("^" + (rmatch(this._path(file))) + "$");
      }
      if (!_.isRegExp(file)) {
        this.emit("error", new Error("Expecting string or regex."));
        return [];
      }
      return _.chain(this.tree).keys().filter(function(k) {
        return k.match(file);
      }).value();
    };

    Doctor.prototype.each = function(file, it, cb) {
      var keys, _ref,
        _this = this;
      if (_.isFunction(file) && !it) {
        _ref = [file, "**"], it = _ref[0], file = _ref[1];
      }
      keys = _.isArray(file) ? _.map(file, this._path.bind(this)) : this.match(file);
      return async.eachSeries(keys, function(f, next) {
        return it.call(null, f, _this._stat(f), next);
      }, function(err) {
        if (_.isFunction(cb)) {
          return cb(err);
        } else if (err) {
          return _this.emit("error", err);
        }
      });
    };

    Doctor.prototype.eachSync = function(file, it) {
      var keys, _ref,
        _this = this;
      if (_.isFunction(file) && !it) {
        _ref = [file, "**"], it = _ref[0], file = _ref[1];
      }
      keys = _.isArray(file) ? _.map(file, this._path.bind(this)) : this.match(file);
      return _.each(keys, function(f) {
        return it.call(null, f, _this._stat(f));
      });
    };

    Doctor.prototype.replace = function(file, it, cb) {
      var _this = this;
      return this.each(file, function(f, stat, follow) {
        var next;
        next = function(val) {
          if (_.has(_this.write_cache, f)) {
            delete _this.write_cache[f];
          }
          return _this.set(f, val, follow);
        };
        if (_.isFunction(it)) {
          return it.call(null, f, stat, next);
        } else {
          return next(it);
        }
      }, function(err) {
        if (_.isFunction(cb)) {
          return cb(err);
        } else if (err) {
          return _this.emit("error", err);
        }
      });
    };

    Doctor.prototype.replaceSync = function(file, it) {
      var _this = this;
      return this.eachSync(file, function(f, stat) {
        if (_.isFunction(it)) {
          return _this.set(f, it.call(null, f, stat));
        } else {
          return _this.set(f, it);
        }
      });
    };

    Doctor.prototype.watch = function(file, cb) {
      var _ref;
      if (_.isFunction(file) && !cb) {
        _ref = [file, "**"], cb = _ref[0], file = _ref[1];
      }
      return this.watchrs.push({
        match: file,
        callback: cb
      });
    };

    Doctor.prototype.unwatch = function(file, cb) {
      var m,
        _this = this;
      m = {
        match: file,
        callback: cb
      };
      return _.some(this.watchrs, function(o, k) {
        if (_.isEqual(o, m)) {
          delete _this.watchrs[k];
          return true;
        }
      });
    };

    Doctor.prototype.find = function(value, cb) {
      return this.search(value, function(files) {
        return cb(_.size(files) ? files[0] : null);
      });
    };

    Doctor.prototype.search = function(value, cb) {
      var _this = this;
      return exec("find . | xargs grep '" + value + "' -isl", {
        timeout: 30 * 1000,
        cwd: this.location
      }, function(err, stdout, stdin) {
        return cb(_.chain(stdout.split('\n')).compact().map(function(p) {
          if (p.substr(0, 1) === ".") {
            return p.substr(1);
          } else {
            return p;
          }
        }).value());
      });
    };

    Doctor.prototype.save = function(cb) {
      return async.each(this.write_cache, function(stream, next) {
        if (stream.writable) {
          stream.on("close", function() {
            return next();
          });
          stream.on("error", function(err) {
            return next(err);
          });
          return stream.end();
        }
      }, function(err) {
        var _this = this;
        if (err) {
          return cb(err);
        } else {
          this.write_cache = {};
          return this.refresh(function(err) {
            if (err) {
              return cb(err);
            } else {
              _this.emit("save");
              return cb();
            }
          });
        }
      });
    };

    Doctor.prototype.load = function(from, to, cb) {
      var _ref;
      if (_.isFunction(to) && !cb) {
        _ref = [to, path.basename(from)], cb = _ref[0], to = _ref[1];
      }
      return fs.copy(from, path.resolve(this.location, to), function(err) {
        var _this = this;
        if (err) {
          return cb(err);
        } else {
          return this.refresh(function(err) {
            if (err) {
              return cb(err);
            } else {
              _this.emit("load", from, to);
              return cb();
            }
          });
        }
      });
    };

    Doctor.prototype.copy = Doctor.prototype.load;

    Doctor.prototype.move = function(file, to, cb) {
      to = path.resolve(this.location, to);
      return mv(this._full_path(file), to, function(err) {
        if (err) {
          return cb(err);
        } else {
          return this.refresh(cb);
        }
      });
    };

    Doctor.prototype.refresh = function(cb) {
      var _this = this;
      this.tree = {};
      return exec("find .", {
        timeout: 30 * 1000,
        cwd: this.location
      }, function(err, stdout, stdin) {
        var files;
        files = _.chain(stdout.split('\n')).compact().map(function(p) {
          p = p.substr(0, 1) === "." ? p.substr(1) : p;
          p = p.substr(0, 1) !== "/" ? "/" + p : p;
          return p;
        }).value();
        return async.each(files, function(file, callback) {
          return fs.stat(_this._full_path(file), function(err, stat) {
            if (err) {
              return callback(err);
            } else {
              _this.tree[file] = stat;
              return callback();
            }
          });
        }, function(err) {
          if (_.isFunction(cb)) {
            return cb(err);
          } else if (err) {
            return _this.emit("error", err);
          }
        });
      });
    };

    Doctor.prototype._path = function(file) {
      if (!file) {
        file = "";
      }
      return "/" + this._sepPath(file).join(path.sep);
    };

    Doctor.prototype._full_path = function(file) {
      return path.join(this.location, this._path(file));
    };

    Doctor.prototype._stat = function(file) {
      return this.tree[this._path(file)];
    };

    return Doctor;

  })(SRPClass);

  module.exports = Doctor;

}).call(this);
