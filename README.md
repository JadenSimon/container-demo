# Synapse + Containers
Infrastructure is code. Runtime and infra can reference each other.

This repo stitches together Docker with `express` and a local or cloud bucket determined at comptime. Resources become concrete during deploytime, before then their state is deferred and cannot be evaluated in logic that requires a concrete value. But you can do a lot without needing to know the value.

Here's the abridged version of the code:

```ts
// everything in the top scope is "comptime", evaluated during compile
const bucket = new Bucket() // this is a resource

function startServer() {
    // runtime code because it's a leaf in the graph
    const app = express()
    app.get('/foo', (req, res) => {
        return bucket.get('foo', 'utf-8')
    })
    app.listen(3000)
}

const code = new Bundle(startServer) // resource
const service = localContainerService(code) // resource
```

Comptime creates the plan for deploytime and deploytime creates the environment for runtime.

Code is infrastructure.

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
synapse compile --target aws
synapse deploy --dry-run # we have a "plan" for our infra after compile

synapse test

# show the deployment state for the symbol
synapse show bucket

# drop into REPL and use the bucket 
synapse repl src/main.ts
> await bucket.get('foo', 'utf-8')

# ctrl+c twice to leave REPL, or type .exit

# replace the bucket (for fun)
synapse replace bucket
synapse deploy

# should show nothing
synapse repl src/main.ts --eval "bucket.get('foo', 'utf-8')"

# cleanup
synapse destroy
```
