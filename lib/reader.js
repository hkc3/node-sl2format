var debug = require('debug')('sl2:reader');
var util = require('util');
var Transform = require('stream').Transform;
var BufferReader = require('./bufferreader');
var Header = require('./header');
var blocks = require('./blocks');


util.inherits(Reader, Transform);

var STATE = {
  Header: 0,
  Body: 1
};

var FLAGS = Object.keys(new blocks.Flags());

function Reader(options) {
  if (!(this instanceof Reader)) {
    return new Reader(options);
  }
  options = options || {};
  this.options = {
    feetToMeter: typeof options.feetToMeter === 'undefined' ? false : options.feetToMeter,
    radToDeg: typeof options.radToDeg === 'undefined' ? false : options.radToDeg,
    speedInUnit: typeof options.speedInUnit === 'string' && blocks.SPEED_UNITS.indexOf(options.speedInUnit) >= 0 ?
      options.speedInUnit : 'kts',
    convertProjection: typeof options.convertProjection === 'undefined' ? false : options.convertProjection,
    rawBlockHeader: typeof options.rawBlockHeader === 'undefined' ? false : options.rawBlockHeader,
    flags: typeof options.flags !== 'object' ? false : options.flags
  };
  Transform.call(this, {
    objectMode: true
  });
  this.header = null;
  this._state = STATE.Header;
  this._buf = null;
  this._pushed = 0;
  this._blocks = 0;
  this._chunk = 0;
}


Reader.prototype._transform = function (chunk, enc, done) {
  if (this._state === STATE.Header) {
    var br = new BufferReader(chunk);
    this.header = Header.read(br);
    chunk = br.toBuffer();
    this._state = STATE.Body;
    this.emit('header', this.header);
  }
  if (this._state === STATE.Body) {
    this.readBlocks(chunk);
  }
  debug('chunk %d done', this._chunk++);
  done();
};


Reader.prototype.readBlocks = function (buf) {
  var flush = false;
  var ignore = false;
  if (typeof buf !== 'undefined') {
    if (this._buf === null) {
      this._buf = buf;
    }
    else {
      this._buf = Buffer.concat([this._buf, buf]);
    }
  }
  else {
    flush = true;
  }
  if (!(this._buf instanceof Buffer)) {
    throw new Error('bad type of _buf ' + typeof buf + ' ' + typeof this._buf);
  }
  var br = new BufferReader(this._buf);

  while (!br.eof()) {
    ignore = false;
    var block = blocks.reader(br, flush, this.options);
    if (flush) {
      this._buf = br.toBuffer();
    }
    if (block === null) {
      this._buf = br.toBuffer();
      return;
    }
    //check if we should filter on flags
    if (this.options.flags) {
      var fk = Object.keys(this.options.flags);
      for (var i = 0; i < fk.length; i++) {
        var f = fk[i];
        if (FLAGS.indexOf(f) >= 0) {
          if (block.flags[f] !== this.options.flags[f]) {
            //excluded by filter
            ignore = true;
          }
        }
      }
    }
    if (!ignore) {
      this._blocks += 1;
      // try {
      this.push(block);
      this._pushed += 1;
      // }
      // catch (err) {
      //   debug('ERROR! blocks: %d, pushed: %d', this._blocks, this._pushed, block);
      //   throw err;
      // }
    }
  }
  debug('empty buffer');
};


Reader.prototype._flush = function (done) {
  debug('flushing with %d in buffer', this._buf.length);
  while (this._buf.length > 1) {
    debug('reading blocks...');
    this.readBlocks();
  }
  debug('flushed %d blocks, %d pushed', this._blocks, this._pushed);
  done();
};

module.exports = Reader;
