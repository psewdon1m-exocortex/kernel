# Execution Runtime

`ExecutionRuntime.run(project, options)` creates an isolated `ExecutionSession`. A session owns cancellation, element states, formal errors, progress, results and timing.

The scheduler starts ready DAG tasks up to the configured concurrency limit. Independent branches run concurrently. `parallelSafe: false` tasks run exclusively. Pure Node results are cached from version, parameters, inputs and Timeline context; downstream invalidation removes affected cache entries.

## Backends

- `MainThreadBackend` is always available;
- `WorkerBackend` accepts a serialized dispatcher built with `createWorkerDispatcher`;
- `HostBackend` delegates to a desktop/server host;
- `GpuBackend` is a stable vendor-neutral interface.

`installExecutionWorker` runs a Node Registry inside a pre-bundled Worker. Arbitrary function source is never serialized or evaluated. Backend policies are `cpu-only`, `gpu-preferred`, and `gpu-required`; missing required GPU produces a formal error.

## Containers

A Container receives one `ValueEnvelope`, calls each compatible Node's `containerAdapter` from top to bottom, then returns one envelope. Its default policy is stop-on-error. Bypass directly maps input to output.

## Streaming

`BoundedAsyncQueue` implements blocking, drop-oldest and drop-newest backpressure with queue metrics. `ContinuousRuntime` keeps a start/stop lifecycle around graph items and exposes throughput, error and drop counts.

## Cancellation and errors

Abort signals propagate through scheduler tasks, backends and Node contexts. Per-Node timeout produces `NODE_TIMEOUT`. Errors are data with `code`, `message`, `nodeId`, `portId`, `backend`, stack and timestamp; they do not terminate the editor process.
