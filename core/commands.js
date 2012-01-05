var util = require('util');
var fs = require('fs');
var path = require('path');

var Dict = require('../lib/Dict');

var controls = require('../settings/controls');
var style = require('../settings/styling');
var builtins = require('../lib/builtins');


// TODO turn this whole thing in a class with some structure




var commands = {
  'Command List': {
    help: 'Shows this list.',
    action: call('showHelp')
  },

  'Load REPL Module': {
    help: 'Dynamically load a module made to integrate with UltraREPL.',
    action: function(cmd, name){
      var help = this.loadModule(name);
      this.showHelp(help);
      return true;
    }
  },

  'Auto-Includer': {
    help: 'Type the name of a built-in module to include it on the current context.',
    type: 'keywords',
    trigger: builtins.libs,
    action: function(lib){
      return require(lib);
    }
  },

  'Require': {
    help: 'Require for contexts without exposing require to the context. Two parameters: .f propName libName. .f functionAsLib -> functionAsLib.name. Object -> properties copied.',
    action: function(cmd, input){
      var parts = input.split(' ');
      var name = parts[0];

      if (parts.length === 2) {
        var lib = this.context.ctx[name] = require(parts[1]);
      } else {
        var lib = require(parts[0]);
        if (typeof lib === 'function' && lib.name.length) {
          this.context.ctx[lib.name] = lib;
        } else if (Object.prototype.toString.call(lib) === '[object Object]') {
          Object.keys(lib).forEach(function(name){
            this.context.ctx[name] = lib[name];
          }, this);
        } else {
          this.context.ctx[name] = lib;
        }
      }
      return lib;
    }
  },

  'Inspect Context': {
    help: 'Shortcut for writing `this` to inspect the current context.',
    action: function(){
      this.context.ctx._ = this.context.ctx;
      this.inspector();
    }
  },

  'Next Page': {
    help: 'Next page of results.',
    action: function(){
      if (this.pages.count() === 0)  return;
      this.rli.writePage(this.pages.next());
      this.header();
    }
  },
  'Previous Page': {
    help: 'Previous page of results.\n',
    action: function(){
      if (this.pages.count() === 0)  return;
      this.rli.writePage(this.pages.previous());
      this.header();
    }
  },

  'Toggle Builtins': {
    help: 'Toggle whether default built-in objects are shown.',
    action: toggle('context', 'builtins')
  },
  'Toggle Hiddens': {
    help: 'Toggle whether hidden properties are shown.',
    action: toggle('context', 'hiddens')
  },
  'Toggle __proto__': {
    help: 'Toggle whether [[prototype]] trees are displayed.',
    action: toggle('context', 'protos')
  },
  'Toggle Colors': {
    help: 'Toggle whether output is colored.',
    action: toggle('context', 'colors')
  },

  'Set Inspect Depth': {
    help: 'Set inspector recurse depth',
    action: function(cmd, depth){
      depth = parseInt(depth, 10);
      if (depth === this.context.depth || !(depth > 0)) {
        this.timedPrompt('depth ' + this.context.depth, style.prompt['--']);
        return this.rli.clearInput();
      }
      depth = depth > 1 ? depth : 1;
      this.timedPrompt('depth ' + depth, style.prompt[this.context.depth > depth ? '--' : '++']);
      this.context.depth = depth;
      this.refresh();
    }
  },

  'Inspect Depth++': {
    help: 'Increase inspector recurse depth',
    action: function(){
      this.context.depth++;
      this.refresh();
      this.timedPrompt('depth ' + this.context.depth, style.prompt['++']);
    }
  },
  'Inspect Depth--': {
    help: 'Decrease inspector recurse depth',
    action: function(){
      if (this.context.depth > 1) {
        this.context.depth--;
        this.refresh();
        this.timedPrompt('depth ' + this.context.depth, style.prompt['--']);
      }
    }
  },

  'Clear Input/Screen': {
    help: 'Clear the the input line if it has text or clears the screen if not.',
    action: function(){
      this.rli.line.trim().length ? this.resetInput() : this.resetScreen() } },
  'Clear Screen': {
    help: 'Clear the screen.',
    action: function(){ this.resetScreen() } },
  'Exit': {
    help: 'Exit the REPL.\n',
    action: function(){ this.rli.close() } },

  'Delete Left'       : { action: function(){ this.rli._deleteLeft()      } },
  'Delete Right'      : { action: function(){ this.rli._deleteRight()     } },
  'Delete Word Left'  : { action: function(){ this.rli._deleteWordLeft()  } },
  'Delete Word Right' : { action: function(){ this.rli._deleteWordRight() } },
  'Delete Line Left'  : { action: function(){ this.rli._deleteLineLeft()  } },
  'Delete Line Right' : { action: function(){ this.rli._deleteLineRight() } },

  'Line Left'         : { action: function(){ this.rli._lineLeft()        } },
  'Line Right'        : { action: function(){ this.rli._lineRight()       } },
  'Word Left'         : { action: function(){ this.rli._wordLeft()        } },
  'Word Right'        : { action: function(){ this.rli._wordRight()       } },
  'Move Left'         : { action: function(){ this.rli._moveLeft()        } },
  'Move Right'        : { action: function(){ this.rli._moveRight()       } },

  'History Prev'      : { action: function(){ this.rli._historyPrev()     } },
  'History Next'      : { action: function(){ this.rli._historyNext()     } },
  'Line'              : { action: function(){ this.rli._line()            } },
  'Tab Complete'      : { action: function(){ this.rli._tabComplete()     } },
};




function toggle(obj, prop){
  return function(){
    if (typeof prop === 'undefined') {
      var result = (this[obj] ^= true);
    } else {
      var result = (this[obj][prop] ^= true);
    }
    result = result ? '++' : '--';
    this.refresh();
    this.timedPrompt(result + (prop || obj), style.prompt[result]);
  }
}

function call(section, prop, args){
  if (typeof args === 'undefined') {
    args = [];
  } else if (!Array.isArray(args)) {
    args = [args];
  }
  return function(){
    if (prop) {
      return this[section][prop].apply(this[section], args)
    } else {
      return this[section].apply(this, args);
    }
  }
}


// TODO this needs to be refactored so badly

module.exports = function(target){
  var keybinds = new Dict;
  var lastpress = Date.now();
  var cmds = target.commands = new Dict;

  target.rli.on('keybind', function(key){
    if (keybinds.has(key.bind)) {
      key.used = true;
      keybinds[key.bind].forEach(function(action){
        action.call(target);
      });
    }

    if (target.keydisplay) {
      target.rli.timedWrite('topright', key.bind, style.info.keydisplay);
    }
    lastpress = Date.now();
  });

  function cadence(keybind, action){
    return function(){
      if (Date.now() - lastpress > 5000) return;

      target.rli.once('keybind', function(key){
        if (keybind === key.bind) {
          key.used = true;
          action.call(target);
        }
      });
    }
  }

  var handlers = {
    keybind: function(bind, action){
      var keys = bind.split(' ');
      bind = keys.pop();
      while (keys.length) {
        action = cadence(bind, action);
        bind = keys.pop();
      }
      var binds = keybinds.has(bind) ? keybinds.get(bind) : keybinds.set(bind, [])
      binds.push(action);
    },
    keywords: function(keywords, action){
      keywords.forEach(function(kw){ cmds[kw] = action });
    },
    keyword: function(kw, action){ cmds[kw] = action },
    command: function(cmd, action){ cmds[cmd] = action }
  };


  var loadModule = target.loadModule = function loadModule(name){
    var commands = {};
    var mod = require(path.resolve(__dirname, '../modules', name));

    var help = mod.map(function(command){
      commands[command.name] = command;

      if (command.defaultTrigger && !(command.name in controls)) {
         controls[command.name] = command.defaultTrigger
      };

      if (!command.help) return '';

      var info = { name: command.name, help: command.help };
      if (controls[command.name]) {
        info.type = controls[command.name].type;
        info.trigger =  controls[command.name].trigger;
      }
      return info;
    });

    initializeControls(commands, controls);
    return help;
  };

  initializeControls(commands, controls);

  require('../settings/modules').autoload.forEach(loadModule);

  function initializeControls(commands, controls){
    Object.keys(commands).forEach(function(name){
      var control = controls[name] || commands[name];

      if (control.type) {
        handlers[control.type](control.trigger, commands[name].action);
      }

      if (!('help' in commands[name])) return;

      if (control.type === 'keybind' && process.platform === 'darwin') {
        control && control.trigger = control.trigger.replace('ctrl+', 'command+');
      }

      target.help.push({
        name: name,
        help: commands[name].help,
        type: control.type,
        trigger: control.trigger
      });
    });
  }
}