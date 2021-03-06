/* global XMLHttpRequest */
import {resolvePath} from '@loaders.gl/core';

// Supports loading (requesting) assets with XHR (XmlHttpRequest)
const XHR_STATES = {
  UNINITIALIZED: 0,
  LOADING: 1,
  LOADED: 2,
  INTERACTIVE: 3,
  COMPLETED: 4
};

class XHR {
  constructor({
    url,
    path = null,
    method = 'GET',
    asynchronous = true,
    noCache = false,
    // body = null,
    sendAsBinary = false,
    responseType = false,
    onProgress = () => {},
    onError = () => {},
    onAbort = () => {},
    onComplete = () => {}
  }) {
    this.url = path ? path.join(path, url) : url;
    this.method = method;
    this.async = asynchronous;
    this.noCache = noCache;
    this.sendAsBinary = sendAsBinary;
    this.responseType = responseType;

    this.req = new XMLHttpRequest();

    this.req.onload = e => onComplete(e);
    this.req.onerror = e => onError(e);
    this.req.onabort = e => onAbort(e);
    this.req.onprogress = e => {
      if (e.lengthComputable) {
        onProgress(e, Math.round((e.loaded / e.total) * 100));
      } else {
        onProgress(e, -1);
      }
    };
  }

  setRequestHeader(header, value) {
    this.req.setRequestHeader(header, value);
    return this;
  }

  sendAsync(body = this.body || null) {
    return new Promise((resolve, reject) => {
      try {
        const {req, method, noCache, sendAsBinary, responseType} = this;

        const url = noCache
          ? this.url + (this.url.indexOf('?') >= 0 ? '&' : '?') + Date.now()
          : this.url;

        req.open(method, url, this.async);

        if (responseType) {
          req.responseType = responseType;
        }

        if (this.async) {
          req.onreadystatechange = e => {
            if (req.readyState === XHR_STATES.COMPLETED) {
              if (req.status === 200) {
                resolve(req.responseType ? req.response : req.responseText);
              } else {
                reject(new Error(`${req.status}: ${url}`));
              }
            }
          };
        }

        if (sendAsBinary) {
          req.sendAsBinary(body);
        } else {
          req.send(body);
        }

        if (!this.async) {
          if (req.status === 200) {
            resolve(req.responseType ? req.response : req.responseText);
          } else {
            reject(new Error(`${req.status}: ${url}`));
          }
        }
      } catch (error) {
        reject(error);
      }
    });
  }
}

export function requestFile(url, opts) {
  if (typeof url !== 'string' && !opts) {
    // TODO - warn for deprecated mode
    opts = url;
    url = opts.url;
  }
  opts.url = resolvePath(url);
  const xhr = new XHR(opts);
  return xhr.sendAsync();
}
