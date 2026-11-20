// Function body used by the WASM host. Keep lifecycle cleanup on every exit.
async function loadSource() {
    if (typeof source === 'string') return source;
    if (!globalThis.__benchupSkpSourcePromise) {
        globalThis.__benchupSkpSourcePromise = (async () => {
            const base = new URL('./assets/skp/', globalThis.location.href);
            const fetchText = async name => {
                const response = await fetch(new URL(name, base));
                if (!response.ok) throw new Error('benchup.skp.worker_failed');
                return response.text();
            };
            const [fflate, earcut, flatbuffers, openskp, adapter] = await Promise.all([
                fetchText('fflate.cjs'),
                fetchText('earcut.cjs'),
                fetchText('flatbuffers.js'),
                fetchText('openskp.cjs'),
                fetchText('skp_adapter.js'),
            ]);
            return (
                'var benchupModules = {};\n' +
                'benchupModules.fflate = (function() { var exports = {}, module = {exports};\n' +
                fflate + '\nreturn module.exports; })();\n' +
                'benchupModules.earcut = (function() { var exports = {}, module = {exports};\n' +
                earcut + '\nreturn module.exports; })();\n' +
                'benchupModules.flatbuffers = (function() {\n' +
                flatbuffers + '\nreturn flatbuffers; })();\n' +
                'benchupModules.openskp = (function() { var exports = {}, module = {exports}; var require = name => benchupModules[name];\n' +
                openskp + '\nreturn module.exports; })();\n' +
                adapter
            );
        })().catch(error => {
            globalThis.__benchupSkpSourcePromise = undefined;
            throw error;
        });
    }
    return globalThis.__benchupSkpSourcePromise;
}
return loadSource().then(resolvedSource => new Promise((resolve, reject) => {
    const body = resolvedSource + `\nonmessage = event => {
        try { postMessage({model: benchupImport(new Uint8Array(event.data))}); }
        catch (error) { postMessage({error: error.message || String(error)}); }
    };`;
    const url = URL.createObjectURL(new Blob([body], {type: 'text/javascript'}));
    let worker, timer;
    const cleanup = () => {
        if (timer) clearTimeout(timer);
        if (worker) worker.terminate();
        URL.revokeObjectURL(url);
    };
    try {
        worker = new Worker(url);
        timer = setTimeout(() => { cleanup(); reject(new Error('benchup.skp.worker_failed')); }, 60000);
        worker.onmessage = event => {
            cleanup();
            if (event.data.error) reject(new Error(event.data.error));
            else resolve(event.data.model);
        };
        worker.onerror = event => { cleanup(); reject(new Error(event.message || 'benchup.skp.worker_failed')); };
        worker.onmessageerror = () => { cleanup(); reject(new Error('benchup.skp.worker_message')); };
        worker.postMessage(bytes.buffer, [bytes.buffer]);
    } catch (error) { cleanup(); reject(error); }
}));
