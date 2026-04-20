import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  buildFlowBatchSummaryCsv,
  loadFlowBatchTasks,
  type FlowBatchTaskExecution,
} from '../src/modules/flow-cli/batch'

const tempPaths: string[] = []

afterEach(() => {
  for (const tempPath of tempPaths.splice(0)) {
    fs.rmSync(tempPath, { force: true })
  }
})

function writeTempFile(name: string, content: string): string {
  const filePath = path.join(
    os.tmpdir(),
    `codey-flow-batch-${process.pid}-${Date.now()}-${name}`,
  )
  fs.writeFileSync(filePath, content, 'utf8')
  tempPaths.push(filePath)
  return filePath
}

describe('flow batch helpers', () => {
  it('loads a single-flow CSV batch and normalizes typed options', () => {
    const batchFile = writeTempFile(
      'login.csv',
      [
        'label,email,headless,slowMo,har',
        'primary,one@example.com,true,250,true',
        'secondary,two@example.com,false,0,false',
      ].join('\n'),
    )

    expect(
      loadFlowBatchTasks({
        batchFile,
        defaultFlowId: 'chatgpt-login',
        options: {
          config: './config.json',
        },
      }),
    ).toEqual([
      {
        taskIndex: 1,
        rowNumber: 2,
        label: 'primary',
        flowId: 'chatgpt-login',
        options: {
          config: './config.json',
          email: 'one@example.com',
          headless: true,
          slowMo: 250,
          har: true,
          record: false,
        },
      },
      {
        taskIndex: 2,
        rowNumber: 3,
        label: 'secondary',
        flowId: 'chatgpt-login',
        options: {
          config: './config.json',
          email: 'two@example.com',
          headless: false,
          slowMo: 0,
          har: false,
          record: false,
        },
      },
    ])
  })

  it('loads a mixed JSON batch and supports nested options payloads', () => {
    const batchFile = writeTempFile(
      'mixed.json',
      JSON.stringify({
        tasks: [
          {
            label: 'login-a',
            flowId: 'chatgpt-login',
            email: 'person@example.com',
          },
          {
            name: 'oauth-b',
            flowId: 'codex-oauth',
            options: {
              identityId: 'identity-123',
              workspaceIndex: 2,
              authorizeUrlOnly: true,
            },
          },
        ],
      }),
    )

    expect(
      loadFlowBatchTasks({
        batchFile,
        options: {
          headless: true,
        },
      }),
    ).toEqual([
      {
        taskIndex: 1,
        rowNumber: 1,
        label: 'login-a',
        flowId: 'chatgpt-login',
        options: {
          headless: true,
          email: 'person@example.com',
          record: false,
        },
      },
      {
        taskIndex: 2,
        rowNumber: 2,
        label: 'oauth-b',
        flowId: 'codex-oauth',
        options: {
          headless: true,
          identityId: 'identity-123',
          workspaceIndex: 2,
          authorizeUrlOnly: true,
          record: false,
        },
      },
    ])
  })

  it('rejects batch tasks that try to keep the browser open', () => {
    const batchFile = writeTempFile(
      'bad.csv',
      ['email,record', 'one@example.com,true'].join('\n'),
    )

    expect(() =>
      loadFlowBatchTasks({
        batchFile,
        defaultFlowId: 'chatgpt-login',
        options: {},
      }),
    ).toThrow(/record true/i)
  })

  it('renders a CSV summary for heterogeneous flow outcomes', () => {
    const executions: FlowBatchTaskExecution[] = [
      {
        task: {
          taskIndex: 1,
          rowNumber: 2,
          label: 'login-a',
          flowId: 'chatgpt-login',
          options: {
            email: 'person@example.com',
            record: false,
          },
        },
        exitCode: 0,
        outcome: {
          flowId: 'chatgpt-login',
          command: 'flow:chatgpt-login',
          status: 'passed',
          startedAt: '2026-04-20T10:00:00.000Z',
          completedAt: '2026-04-20T10:00:05.000Z',
          durationMs: 5000,
          options: {
            email: 'person@example.com',
          },
          result: {
            pageName: 'chatgpt-login',
            email: 'person@example.com',
            authenticated: true,
            method: 'password',
            url: 'https://chatgpt.com',
            harPath: 'C:/tmp/login.har',
            storedIdentity: {
              id: 'identity-123',
            },
          },
        },
      },
      {
        task: {
          taskIndex: 2,
          rowNumber: 3,
          label: 'oauth-b',
          flowId: 'codex-oauth',
          options: {
            identityId: 'identity-789',
            record: false,
          },
        },
        exitCode: 1,
        outcome: {
          flowId: 'codex-oauth',
          command: 'flow:codex-oauth',
          status: 'failed',
          startedAt: '2026-04-20T10:01:00.000Z',
          completedAt: '2026-04-20T10:01:03.000Z',
          durationMs: 3000,
          options: {
            identityId: 'identity-789',
          },
          error: 'Timed out waiting for redirect',
        },
      },
    ]

    expect(buildFlowBatchSummaryCsv(executions)).toBe(
      [
        'taskIndex,rowNumber,label,flowId,pageName,status,exitCode,signal,startedAt,completedAt,durationMs,email,identityId,authenticated,verified,method,inviteStrategy,inviteRequested,inviteInvited,inviteSkipped,inviteErrored,sharedIdentityId,sharedSessionId,channel,projectId,redirectUri,url,harPath,apiHarPath,error',
        '1,2,login-a,chatgpt-login,chatgpt-login,passed,0,,2026-04-20T10:00:00.000Z,2026-04-20T10:00:05.000Z,5000,person@example.com,identity-123,true,,password,,,,,,,,,,,https://chatgpt.com,C:/tmp/login.har,,',
        '2,3,oauth-b,codex-oauth,,failed,1,,2026-04-20T10:01:00.000Z,2026-04-20T10:01:03.000Z,3000,,identity-789,,,,,,,,,,,,,,,,,Timed out waiting for redirect',
        '',
      ].join('\n'),
    )
  })
})
