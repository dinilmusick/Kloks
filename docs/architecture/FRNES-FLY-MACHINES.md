# Fly Machines provider-backed compute resources

- Read CPU, memory, GPU count, region and machine state from Fly Machines API, not free-tier pricing descriptions.
- `listFlyMachines` and `getFlyMachine` return validated resource snapshots. Malformed responses fail closed.
- `createFlyMachine` validates exact app, image, region, machine name, CPU and RAM, and returns only the provider-created machine response. Creation can incur charges; the owner and quota/permission decision belongs to the invoking application.
- `mutateFlyMachine` performs real start, stop and delete calls. `accepted: true` means Fly accepted the request, NOT that a long-running state transition completed. Re-read `getFlyMachine` to verify the result.
- No hidden account selection, secrets persistence, external scheduler, or synthetic free-tier quota. The authenticated caller must verify workspace ownership and SRKL account authorization before passing credentials.
- Official reference: https://flyio-landing.fly.dev/docs/machines/api/machines-resource/ and https://machines-api-spec.fly.dev/machines/Machines_list
- Fly trial is not a renewing free quota. User-weighted routing is explicit when quota telemetry is absent.
