import { Edge, Node, useEdgesState, useNodesState } from '@xyflow/react'
import React, { useCallback, useEffect, useRef, useState, useMemo } from 'react'
import type { EdgeData, NodeData } from '../nodes/nodes.types'
import { ApiFlowNode } from '../nodes/api-flow-node'
import { NoopFlowNode } from '../nodes/noop-flow-node'
import { EventFlowNode } from '../nodes/event-flow-node'
import { CronNode } from '@/publicComponents/cron-node'
import isEqual from 'fast-deep-equal'
import { useSaveWorkflowConfig } from '@/views/flow/hooks/use-save-workflow-config'

type Emit = string | { topic: string; label?: string }

type FlowStep = {
  id: string
  name: string
  type: 'event' | 'api' | 'noop' | 'cron'
  description?: string
  subscribes?: string[]
  emits: Emit[]
  virtualEmits?: Emit[]
  action?: 'webhook'
  webhookUrl?: string
  language?: string
  nodeComponentPath?: string
  filePath?: string
}

export type FlowResponse = {
  id: string
  name: string
  steps: FlowStep[]
  edges: FlowEdge[]
  error?: string
}

export type FlowConfigResponse = {
  id: string
  config: {
    [stepName: string]: Position
  }
}

type FlowEdge = {
  id: string
  source: string
  target: string
  data: EdgeData
}

type Position = {
  x: number
  y: number
}

const DEFAULT_POSITION: Position = { x: 0, y: 0 }

const getNodePosition = (flowConfig: FlowConfigResponse | null, stepName: string): Position => {
  return flowConfig?.config[stepName] || DEFAULT_POSITION
}

type FlowState = {
  nodes: Node<NodeData>[]
  edges: Edge<EdgeData>[]
  nodeTypes: Record<string, React.ComponentType<any>> // eslint-disable-line @typescript-eslint/no-explicit-any
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const nodeComponentCache = new Map<string, React.ComponentType<any>>()

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const BASE_NODE_TYPES: Record<string, React.ComponentType<any>> = {
  event: EventFlowNode,
  api: ApiFlowNode,
  noop: NoopFlowNode,
  cron: CronNode,
}

async function importFlow(flow: FlowResponse, flowConfig: FlowConfigResponse | null): Promise<FlowState> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nodeTypes: Record<string, React.ComponentType<any>> = { ...BASE_NODE_TYPES }

  const customNodePromises = flow.steps
    .filter((step) => step.nodeComponentPath)
    .map(async (step) => {
      const path = step.nodeComponentPath!

      // Check cache first
      if (nodeComponentCache.has(path)) {
        nodeTypes[path] = nodeComponentCache.get(path)!
        return
      }

      try {
        const module = await import(/* @vite-ignore */ `/@fs/${path}`)
        const component = module.Node ?? module.default
        nodeComponentCache.set(path, component)
        nodeTypes[path] = component
      } catch (error) {
        console.error(`Failed to load custom node component: ${path}`, error)
      }
    })

  await Promise.all(customNodePromises)

  const nodes: Node<NodeData>[] = flow.steps.map((step) => ({
    id: step.id,
    type: step.nodeComponentPath || step.type,
    filePath: step.filePath,
    position: step.filePath ? getNodePosition(flowConfig, step.filePath) : DEFAULT_POSITION,
    data: step,
    language: step.language,
  }))

  const edges: Edge<EdgeData>[] = flow.edges.map((edge) => ({
    ...edge,
    type: 'base',
  }))

  return { nodes, edges, nodeTypes }
}

export const useGetFlowState = (flow: FlowResponse, flowConfig: FlowConfigResponse) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [nodeTypes, setNodeTypes] = useState<Record<string, React.ComponentType<any>>>(BASE_NODE_TYPES)
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<NodeData>>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge<EdgeData>>([])

  const saveConfig = useSaveWorkflowConfig()

  const flowIdRef = useRef<string>('')
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout>>(null)
  const lastSavedConfigRef = useRef<FlowConfigResponse['config']>(null)
  const lastSavedFlowRef = useRef<FlowResponse>(null)

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const memoizedFlowConfig = useMemo(() => flowConfig, [flowConfig?.id, flowConfig?.config])

  useEffect(() => {
    if (!flow || flow.error) return
    const hasSameConfig = isEqual(lastSavedConfigRef.current, memoizedFlowConfig?.config)
    const hasSameFlow = isEqual(lastSavedFlowRef.current, flow)

    if (hasSameConfig && hasSameFlow) return

    lastSavedConfigRef.current = memoizedFlowConfig?.config
    flowIdRef.current = flow.id
    lastSavedFlowRef.current = flow

    const importFlowAsync = async () => {
      try {
        const { nodes, edges, nodeTypes } = await importFlow(flow, flowConfig)
        setNodes(nodes)
        setEdges(edges)
        setNodeTypes(nodeTypes)
      } catch (error) {
        console.error('Failed to import flow:', error)
      }
    }

    importFlowAsync()
  }, [flow, memoizedFlowConfig, setNodes, setEdges, flowConfig])

  const saveFlowConfig = useCallback(
    (nodesToSave: Node<NodeData>[]) => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }

      saveTimeoutRef.current = setTimeout(async () => {
        const steps = nodesToSave.reduce<FlowConfigResponse['config']>((acc, node) => {
          if (node.data.filePath) {
            acc[node.data.filePath] = {
              x: Math.round(node.position.x),
              y: Math.round(node.position.y),
            }
          }
          return acc
        }, {})

        if (!isEqual(steps, lastSavedConfigRef.current)) {
          lastSavedConfigRef.current = steps
          const newConfig = { id: flowIdRef.current, config: steps }

          try {
            await saveConfig(newConfig)
          } catch (error) {
            console.error('Failed to save flow config:', error)
          }
        }
      }, 300)
    },
    [saveConfig],
  )

  useEffect(() => {
    if (nodes.length > 0) {
      saveFlowConfig(nodes)
    }

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }
    }
  }, [nodes, saveFlowConfig])

  return useMemo(
    () => ({ nodes, edges, onNodesChange, onEdgesChange, nodeTypes }),
    [nodes, edges, onNodesChange, onEdgesChange, nodeTypes],
  )
}
