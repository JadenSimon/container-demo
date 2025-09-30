# Synapse + Containers

Infrastructure is code. I'm stiching together Docker with `express` and a local or cloud bucket.

Everything is TypeScript. No Terraform HCL, no YAML.

## What’s going on here

* Spins up an Express server in a container. Using code.
* Glues a Bucket onto it, because everyone needs a Bucket sometimes.
* Adds a health check so tests don’t explode on startup.
* Runs locally with a fake bucket, or against real S3 if you flip a switch.

It’s functional duct tape that holds.

## How to run

### Required tools
* Docker
* [Synapse](https://github.com/Cohesible/synapse?tab=readme-ov-file#installation)

### Commands

```shell
# local mode with local bucket
synapse test

# cleanup
synapse destroy

# real S3 bucket (using ~/.aws/credentials)
synapse deploy --target aws
synapse test

# show the deployment state for the symbol
synapse show bucket

# drop into REPL and use the bucket 
synapse repl src/main.ts
> await bucket.get('foo', 'utf-8')

# Pess ctrl+c twice to leave REPL or type .exit

# replace the bucket (for fun)
synapse replace bucket
synapse deploy

# should show nothing
synapse repl src/main.ts --eval "bucket.get('foo', 'utf-8')"

# cleanup
synapse destroy
```
