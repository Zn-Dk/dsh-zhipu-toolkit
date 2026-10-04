import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import LlmRuntime, { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm'
import { AttachmentId, ImageVariantId } from '@deepseek-ai/dsh-attachment'
import type { ImageAttachmentRef, RequestImageAttachment } from '@deepseek-ai/dsh-attachment'
import * as ZhipuToolkit from '../src/index.ts'

let context: Context | undefined

/**
 * Minimal 'credentials' service: the toolkit only resolves the endpoint key
 * ref, so one static value is enough for the wired route.
 */
class FakeCredentials extends Service {
  constructor(ctx: Context) {
    super(ctx, 'credentials')
  }

  resolve(_ref: unknown): Promise<{ value: string, source: string } | undefined> {
    return Promise.resolve({ value: 'coding-key', source: 'test' })
  }
}

/**
 * Minimal 'attachments' service exposing only the request-image seam the
 * LlmAdapter contract consumes: readImageRequest(ref, policy, signal).
 */
class FakeAttachments extends Service {
  static readCalls: string[] = []
  static images = new Map<string, Uint8Array>()

  constructor(ctx: Context) {
    super(ctx, 'attachments')
  }

  readImageRequest(ref: ImageAttachmentRef): Promise<RequestImageAttachment> {
    FakeAttachments.readCalls.push(String(ref.attachmentId))
    const data = FakeAttachments.images.get(String(ref.attachmentId))
    if (data === undefined) throw new Error(`no stored image ${String(ref.attachmentId)}`)
    return Promise.resolve({
      variantId: ImageVariantId(`variant-${String(ref.attachmentId)}`),
      attachment: ref,
      data,
      mediaType: ref.mediaType,
      bytes: data.byteLength,
      width: ref.width,
      height: ref.height,
      depth: 'uchar',
    })
  }

  /** AttachmentStore seam consulted for offload placeholder text; not host-file-backed here. */
  imageHostPath(_ref: ImageAttachmentRef): string | undefined {
    return undefined
  }
}

const LIVE_RESPONSE = {
  data: [
    { id: 'glm-4.5' },
    { id: 'glm-4.5-air' },
    { id: 'glm-4.6' },
    { id: 'glm-4.7' },
    { id: 'glm-5' },
    { id: 'glm-5-turbo' },
    { id: 'glm-5.1' },
    { id: 'glm-5.2' },
    { id: 'glm-5.3' },
    { id: 'glm-5.3-flash' },
    { id: 'glm-5v-turbo' },
    { id: 'embedding-3' },
  ],
}

const LIVE_IDS = [
  'glm-4.5-air',
  'glm-4.7',
  'glm-5-turbo',
  'glm-5.1',
  'glm-5.2',
  'glm-5v-turbo',
  'glm-4.5',
  'glm-4.6',
  'glm-5',
  'glm-5.3',
  'glm-5.3-flash',
]

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  FakeAttachments.readCalls = []
  FakeAttachments.images.clear()
  vi.unstubAllGlobals()
})

function stubFetch(bodies: string[]): void {
  vi.stubGlobal('fetch', (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (typeof init?.body === 'string') bodies.push(init.body)
    if (url.endsWith('/models')) {
      return Promise.resolve(new Response(JSON.stringify(LIVE_RESPONSE)))
    }
    const events = [
      '{"choices":[{"delta":{"role":"assistant","content":""},"index":0,"finish_reason":null}]}',
      '{"choices":[{"delta":{"content":"hello"},"index":0,"finish_reason":null}]}',
      '{"choices":[{"delta":{},"index":0,"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":1}}',
      '[DONE]',
    ]
    return Promise.resolve(new Response(events.map(event => `data: ${event}\n\n`).join(''), {
      headers: { 'content-type': 'text/event-stream' },
    }))
  })
}

describe('durable image attachments', () => {
  it('delivers an image block to the wire as inline base64 through the attachments service', async () => {
    const bodies: string[] = []
    stubFetch(bodies)

    const jpegBytes = Uint8Array.from([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46,
    ])
    const ref: ImageAttachmentRef = {
      attachmentId: AttachmentId('sha256:attachments-spec-image'),
      mediaType: 'image/jpeg',
      bytes: jpegBytes.byteLength,
      width: 4,
      height: 4,
    }
    FakeAttachments.images.set(String(ref.attachmentId), jpegBytes)

    context = new Context()
    await context.plugin(LlmRuntime)
    await context.plugin(FakeCredentials)
    await context.plugin(FakeAttachments)
    await context.plugin(ZhipuToolkit, { endpoints: 'coding' })

    await vi.waitFor(async () => {
      expect((await context.llm.listModels('zai')).map(model => model.id)).toEqual(LIVE_IDS)
    })

    const assembler = new BlockAssembler()
    for await (const chunk of context.llm.stream({
      provider: 'zai',
      model: 'glm-5.3-flash',
      messages: [createUserMessage({
        content: [
          { type: 'text', text: 'what do you see' },
          { type: 'image', attachment: ref },
        ],
        source: { kind: 'plugin', plugin: 'test' },
      })],
    })) assembler.push(chunk)

    expect(assembler.message({ kind: 'model', provider: 'zai', model: 'glm-5.3-flash' }).content)
      .toEqual([{ type: 'text', text: 'hello' }])
    // The store was actually consulted for the request version.
    expect(FakeAttachments.readCalls).toEqual([String(ref.attachmentId)])
    // The stored bytes reached the wire as an inline data URI.
    const expected = `data:image/jpeg;base64,${Buffer.from(jpegBytes).toString('base64')}`
    expect(bodies.length).toBeGreaterThan(0)
    expect(bodies[bodies.length - 1]).toContain(expected)
  })
})
