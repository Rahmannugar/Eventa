# Eventa gRPC Contracts

This package owns Eventa's language-neutral protobuf schemas and the generated TypeScript contracts consumed by NestJS services.

## Source and generated code

- `proto/` is authoritative. Its directory layout mirrors each protobuf package, such as `eventa/identity/v1`.
- `src/generated/` is committed, deterministic ts-proto output. Never edit it directly.
- `src/identity/v1/` exposes the stable package surface and owns only runtime helpers that cannot be derived from protobuf, such as loader paths.
- A consuming service may own a narrow transport type when its runtime needs behavior outside protobuf. The Gateway's deadline-aware grpc-js call options are one example.

Buf validates schema conventions and orchestrates the pinned ts-proto generator. The generated NestJS contracts include message types, package and service constants, client/controller interfaces, and controller decorators.

## Commands

From the repository root:

```bash
pnpm proto:generate
pnpm proto:check
pnpm proto:breaking
```

`proto:generate` regenerates TypeScript from every protobuf schema. `proto:check` regenerates and fails if the committed output was stale. `proto:breaking` compares the current schema with the repository's Git baseline using Buf's package-level compatibility policy.

The regular repository verification gate runs Buf linting and generated-output drift detection through this package's lint and test tasks. Breaking-change comparison remains an explicit developer command because Docker build contexts do not contain Git history.
