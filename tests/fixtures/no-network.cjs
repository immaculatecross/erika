// A NETWORK SENSOR for a child process (E-42 criterion 11).
//
// Loaded with `node --require`, it wraps every way this codebase could reach the
// outside world — an outbound socket, a DNS lookup, `fetch`, `http(s).request` — and
// appends one line per attempt to the file named by `ERIKA_NETWORK_LOG`. It does not
// block the call; the log IS the assertion, and a test that reads it empty has
// proved the process made no network call rather than merely believing so.
//
// Why a sensor and not a mock: the claim under test is about the WHOLE keyless
// worker path, including code that no test imports directly. Only something below
// every module can see all of it.
//
// CommonJS on purpose — `--require` predates ESM loaders and works on every Node the
// repo supports.

const fs = require("node:fs");
const net = require("node:net");
const dns = require("node:dns");
const http = require("node:http");
const https = require("node:https");

const LOG = process.env.ERIKA_NETWORK_LOG;

function note(kind, detail) {
  if (!LOG) return;
  try {
    fs.appendFileSync(LOG, `${kind} ${detail}\n`);
  } catch {
    // A sensor must never be the reason a process dies.
  }
}

/**
 * Describe a `Socket.prototype.connect` call.
 *
 * Node hands this method the result of its internal `normalizeArgs`, so `args[0]` is
 * an ARRAY `[options, callback]`, not the options object the caller wrote. Reading
 * `args[0].host` therefore yields undefined and every target reads "?:?" — which is
 * exactly the kind of quietly-blind sensor this file exists to rule out, so the shape
 * is unwrapped explicitly and `tests/coldstart-keyless-worker.test.ts` asserts on the
 * resolved address rather than merely on a line being present.
 */
function describeConnect(args) {
  let opts = args[0];
  if (Array.isArray(opts)) opts = opts[0];
  if (typeof opts === "object" && opts !== null) {
    // A unix-domain socket is not the network — it is how this process talks to
    // itself and to local daemons — so it is recorded distinctly and the test asserts
    // on the off-machine kinds only.
    if (opts.path) return ["UNIX", `unix:${opts.path}`];
    return ["SOCKET", `${opts.host ?? opts.hostname ?? "?"}:${opts.port ?? "?"}`];
  }
  // The positional form: connect(port[, host][, cb]) / connect(path[, cb]).
  if (typeof opts === "string") return ["UNIX", `unix:${opts}`];
  return ["SOCKET", `${args[1] ?? "?"}:${opts ?? "?"}`];
}

const realConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function connect(...args) {
  const [kind, target] = describeConnect(args);
  note(kind, target);
  return realConnect.apply(this, args);
};

const realLookup = dns.lookup;
dns.lookup = function lookup(hostname, ...rest) {
  note("DNS", String(hostname));
  return realLookup.call(this, hostname, ...rest);
};

for (const [name, mod] of [
  ["http", http],
  ["https", https],
]) {
  const realRequest = mod.request;
  mod.request = function request(...args) {
    const first = args[0];
    note("REQUEST", `${name} ${typeof first === "string" ? first : (first && first.host) || "?"}`);
    return realRequest.apply(this, args);
  };
}

if (typeof globalThis.fetch === "function") {
  const realFetch = globalThis.fetch;
  globalThis.fetch = function fetch(input, init) {
    note("FETCH", typeof input === "string" ? input : String((input && input.url) || input));
    return realFetch.call(this, input, init);
  };
}
