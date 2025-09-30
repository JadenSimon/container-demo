import express from 'express'
import * as lib from 'synapse:lib'
import * as os from 'node:os'
import * as path from 'node:path'
import * as stream from 'node:stream'
import * as core from 'synapse:core'
import { Bucket } from 'synapse:srl/storage'
import { localContainerService, ServiceOpts } from './containers'
import { test, expectEqual } from 'synapse:test'

const hostPort = 8090
const containerPort = 3000
const healthCheckPath = '/health'

// Our entrypoint for our container service, this runs _inside the container_
function startServer() {
    const app = express()

    app.get(healthCheckPath, (req, res) => res.status(204).send())

    app.get('/foo', async (req, res) => {
        const blob = await bucket.get('foo')
        if (!blob) {
            return res.status(404).send()
        }
        stream.Readable.fromWeb(blob.stream() as any).pipe(res)
    })

    app.put('/foo', async (req, res) => {
        await bucket.put('foo', req)
        res.send()
    })

    app.listen(containerPort, () => {
        console.log('started!')
    })
}

// `Bucket` is an abstract "standard resource" that resolves to different packages
// based on the `--target` CLI option.
//
// `synapse test --target aws` uses the implementation in `@cohesible/synapse-aws/s3`
// Otherwise it uses `@cohesible/synapse-local`
export const bucket = new Bucket()

// We can adjust our container service based on the deployment target
const extraOpts: Partial<ServiceOpts> = {}
if (process.env.SYNAPSE_TARGET === 'aws') {
    extraOpts.volumes = { [path.resolve(os.homedir(), '.aws')]: '/.aws' }
    extraOpts.env = {
        AWS_SHARED_CREDENTIALS_FILE: '/.aws/credentials',
        // `__getDefaultProvider` isn't a public API yet
        AWS_REGION: __getDefaultProvider('aws').regionId,
    }
}

// `Bundle` does what it says: bundles up code. 
// `Bundle` is itself a resource; the final artifact is only created at deploytime.
const code = new lib.Bundle(startServer, { immediatelyInvoke: true })
const service = localContainerService(code, {
    ports: { [hostPort]: containerPort },
    ...extraOpts,
})

// Simple resource definition that acts as both a sanity check and a place for dependents to start from
class HealthCheck extends core.defineResource({
    create: async (pathname: string) => {
        const baseUrl = `http://${service.hostname}:${hostPort}`

        let attempts = 0
        while (attempts++ < 3) {
            try {
                const resp = await fetch(new URL(pathname, baseUrl))
                if (resp.status !== 204) {
                    throw new Error(`expected 204, got: ${resp.status} [${resp.statusText}]`)
                }
                
                console.log(`DING! Your service is ready!`)
                console.log(`Here's a command for you:`)
                console.log(`  curl ${baseUrl}/foo`)

                return { baseUrl, fingerprint: service.instanceId }
            } catch (err) {
                if (attempts > 1) { // silence the first failure
                    console.log('healthcheck failed', attempts, (err as any).message)
                }
                await new Promise<void>(r => setTimeout(r, attempts*500))
            }
        }

        throw new Error('failed to talk to service')
    },
}) {}

const checkedService = new HealthCheck(healthCheckPath)

// This test uses `checkedService` for the url to ensure tests are only ran after the service is ready
test('/foo', async () => {
    await fetch(new URL('/foo', checkedService.baseUrl), {
        method: 'PUT',
        body: 'bar',
    })

    const resp = await fetch(new URL('/foo', checkedService.baseUrl)).then(x => x.text())
    expectEqual(resp, 'bar')
})
