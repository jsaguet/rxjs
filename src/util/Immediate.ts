/**
Some credit for this helper goes to http://github.com/YuzuJS/setImmediate
*/

import { root } from './root';

export class ImmediateDefinition {
  setImmediate: (cb: () => void) => number;

  clearImmediate: (handle: number) => void;

  private identify(o: any): string {
    return this.root.Object.prototype.toString.call(o);
  }

  tasksByHandle: any;

  nextHandle: number;

  currentlyRunningATask: boolean;

  constructor(private root: any) {
    if (root.setImmediate) {
      this.setImmediate = root.setImmediate;
      this.clearImmediate = root.clearImmediate;
    } else {
      this.nextHandle = 1;
      this.tasksByHandle = {};
      this.currentlyRunningATask = false;

      // Don't get fooled by e.g. browserify environments.
      if (this.canUseProcessNextTick()) {
        // For Node.js before 0.9
        this.setImmediate = this.createProcessNextTickSetImmediate();
      } else if (this.canUsePostMessage()) {
        // For non-IE10 modern browsers
        this.setImmediate = this.createPostMessageSetImmediate();
      } else if (this.canUseMessageChannel()) {
        // For web workers, where supported
        this.setImmediate = this.createMessageChannelSetImmediate();
      } else if (this.canUseReadyStateChange()) {
        // For IE 6–8
        this.setImmediate = this.createReadyStateChangeSetImmediate();
      } else {
        // For older browsers
        this.setImmediate = this.createSetTimeoutSetImmediate();
      }

      let ci = function clearImmediate(handle) {
        delete (<any>clearImmediate).instance.tasksByHandle[handle];
      };

      (<any>ci).instance = this;

      this.clearImmediate = ci;
    }
  }

  canUseProcessNextTick() {
    return this.identify(this.root.process) === '[object process]';
  }

  canUseMessageChannel() {
    return Boolean(this.root.MessageChannel);
  }

  canUseReadyStateChange() {
    const document = this.root.document;
    return Boolean(document && 'onreadystatechange' in document.createElement('script'));
  }

  canUsePostMessage() {
    const root = this.root;
    // The test against `importScripts` prevents this implementation from being installed inside a web worker,
    // where `root.postMessage` means something completely different and can't be used for this purpose.
    if (root.postMessage && !root.importScripts) {
      let postMessageIsAsynchronous = true;
      let oldOnMessage = root.onmessage;
      root.onmessage = function() {
        postMessageIsAsynchronous = false;
      };
      root.postMessage('', '*');
      root.onmessage = oldOnMessage;
      return postMessageIsAsynchronous;
    }

    return false;
  }

  // This function accepts the same arguments as setImmediate, but
  // returns a function that requires no arguments.
  partiallyApplied(handler, ...args) {
    let fn = function result () {
      const { handler, args } = <any>result;
      if (typeof handler === 'function') {
        handler.apply(undefined, args);
      } else {
        (new Function('' + handler))();
      }
    };

    (<any>fn).handler = handler;
    (<any>fn).args = args;

    return fn;
  }

  addFromSetImmediateArguments(args) {
    this.tasksByHandle[this.nextHandle] = this.partiallyApplied.apply(undefined, args);
    return this.nextHandle++;
  }

  createProcessNextTickSetImmediate() {
    let fn = function setImmediate() {
      const named = (<any>setImmediate);
      const { root, addFromSetImmediateArguments, partiallyApplied, runIfPresent } = named.instance;
      let handle = addFromSetImmediateArguments(arguments);
      root.process.nextTick(partiallyApplied(runIfPresent, handle));
      return handle;
    };

    (<any>fn).instance = this;

    return fn;
  }

  createPostMessageSetImmediate() {
    // Installs an event handler on `global` for the `message` event: see
    // * https://developer.mozilla.org/en/DOM/window.postMessage
    // * http://www.whatwg.org/specs/web-apps/current-work/multipage/comms.html#crossDocumentMessages
    const root = this.root;
    const runIfPresent = this.runIfPresent;

    let messagePrefix = 'setImmediate$' + root.Math.random() + '$';
    let onGlobalMessage = function (event) {
      if (event.source === root &&
        typeof event.data === 'string' &&
        event.data.indexOf(messagePrefix) === 0) {
        runIfPresent(+event.data.slice(messagePrefix.length));
      }
    };

    root.addEventListener('message', onGlobalMessage, false);

    let fn = function setImmediate() {
      const { messagePrefix, instance: { root, addFromSetImmediateArguments } } = (<any>setImmediate);
      let handle = addFromSetImmediateArguments(arguments);
      root.postMessage(messagePrefix + handle, '*');
      return handle;
    };

    (<any>fn).instance = this;
    (<any>fn).messagePrefix = messagePrefix;

    return fn;
  }

  runIfPresent(handle) {
    // From the spec: 'Wait until any invocations of this algorithm started before this one have completed.'
    // So if we're currently running a task, we'll need to delay this invocation.
    if (this.currentlyRunningATask) {
      // Delay by doing a setTimeout. setImmediate was tried instead, but in Firefox 7 it generated a
      // 'too much recursion' error.
      this.root.setTimeout(this.partiallyApplied(this.runIfPresent, handle), 0);
    } else {
      let task = this.tasksByHandle[handle];
      if (task) {
        this.currentlyRunningATask = true;
        try {
          task();
        } finally {
          this.clearImmediate(handle);
          this.currentlyRunningATask = false;
        }
      }
    }
  }

  createMessageChannelSetImmediate() {
    let channel = new this.root.MessageChannel();
    channel.port1.onmessage = (event) => {
      let handle = event.data;
      this.runIfPresent(handle);
    };

    let fn = function setImmediate() {
      const { channel, instance } = (<any>setImmediate);
      let handle = instance.addFromSetImmediateArguments(arguments);
      channel.port2.postMessage(handle);
      return handle;
    };

    (<any>fn).channel = channel;
    (<any>fn).instance = this;

    return fn;
  }

  createReadyStateChangeSetImmediate() {
    let fn = function setImmediate() {
      const instance = (<any>setImmediate).instance;
      const { root, runIfPresent, addFromSetImmediateArguments } = instance;
      const doc = root.document;
      const html = doc.documentElement;

      let handle = addFromSetImmediateArguments(arguments);
      // Create a <script> element; its readystatechange event will be fired asynchronously once it is inserted
      // into the document. Do so, thus queuing up the task. Remember to clean up once it's been called.
      let script = doc.createElement('script');
      script.onreadystatechange = () => {
        runIfPresent(handle);
        script.onreadystatechange = null;
        html.removeChild(script);
        script = null;
      };
      html.appendChild(script);
      return handle;
    };

    (<any>fn).instance = this;

    return fn;
  }

  createSetTimeoutSetImmediate() {
    let fn = function setImmediate() {
      const instance = (<any>setImmediate).instance;
      const { runIfPresent, partiallyApplied, root } = instance;
      let handle = instance.addFromSetImmediateArguments(arguments);
      root.setTimeout(partiallyApplied(runIfPresent, handle), 0);
      return handle;
    };

    (<any>fn).instance = this;

    return fn;
  }
}
export const Immediate = new ImmediateDefinition(root);