# Security and Performance

## Security model

- no `eval`, script fields or executable plugin code in projects;
- trusted build-time plugins only in v0;
- signature/MIME/content/extension asset detection;
- SVG scripts, event attributes, `foreignObject` and dangerous links are rejected;
- ZIP traversal and uncompressed-size protection;
- side-effect Nodes require explicit execution permission;
- filesystem/network operations exist only through host services;
- remote Machine API transports require host authentication, authorization, rate limits and auditing.

Never treat a project dependency declaration as authorization to install or execute code.

## Performance design

The Canvas applies viewport culling, one transform for world navigation, memoized Node views, simplified minimap geometry and thumbnail previews. Drag movement is local until committed as one model command.

The runtime uses topological scheduling, independent-branch parallelism, async execution, cancellation, pure-result caching and backend adapters. Media preview uses object URLs and lazy browser decoding; Timeline updates seek previews without serializing pixels into the project.

Target benchmark fixtures should cover 500/1,000 visible elements and 1,000/2,000 connections, plus serial, parallel, Worker and streaming graphs. Run `npm test` for correctness before comparing performance results.
