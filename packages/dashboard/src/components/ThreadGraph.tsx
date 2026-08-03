import type { TreeData, TreeNode, CommitNode as CommitNodeType } from '../lib/api';

const BRANCH_COLORS = ['#58a6ff', '#3fb950', '#d29922', '#f85149', '#bc8cff', '#79c0ff'];

interface ThreadGraphProps {
  tree: TreeData;
  commits: CommitNodeType[];
  selectedId?: string | null;
  onSelectNode?: (id: string) => void;
}

export function ThreadGraph({ tree, commits, selectedId, onSelectNode }: ThreadGraphProps) {
  if (!tree.nodes.length) {
    return <p className="text-[#8b949e] text-sm">No graph data available.</p>;
  }

  const PADDING_X = 60;
  const PADDING_Y = 40;
  const ROW_H = 70;
  const BRANCH_OFFSET = 100;
  const NODE_R = 10;

  const nodeMap = new Map<string, { x: number; y: number; node: TreeNode }>();
  const branchColorMap = new Map<string, string>();
  let branchIdx = 0;

  // Layout: trunk (branchId=null) at x=PADDING_X, branches offset right
  const trunkNodes = tree.nodes.filter((n) => n.branchId === null);
  const branchNodes = tree.nodes.filter((n) => n.branchId !== null);

  // Sort trunk nodes by y (or reverse order for newest-at-top)
  trunkNodes.sort((a, b) => a.y - b.y);

  const laid: { id: string; x: number; y: number; node: TreeNode }[] = [];

  trunkNodes.forEach((node, i) => {
    const x = PADDING_X;
    const y = PADDING_Y + i * ROW_H;
    laid.push({ id: node.id, x, y, node });
    nodeMap.set(node.id, { x, y, node });
  });

  // Group branch nodes by branchId
  const byBranch = new Map<string, TreeNode[]>();
  branchNodes.forEach((n) => {
    const list = byBranch.get(n.branchId!) ?? [];
    list.push(n);
    byBranch.set(n.branchId!, list);
  });

  byBranch.forEach((nodes, branchId) => {
    if (!branchColorMap.has(branchId)) {
      branchColorMap.set(branchId, BRANCH_COLORS[branchIdx % BRANCH_COLORS.length]);
      branchIdx++;
    }
    const color = branchColorMap.get(branchId)!;
    nodes.sort((a, b) => a.y - b.y);

    // Find the parent trunk node to fork from
    const firstNode = nodes[0];
    const parentEdge = tree.edges.find((e) => e.to === firstNode.id);
    const parentNode = parentEdge ? nodeMap.get(parentEdge.from) : null;
    const startY = parentNode ? parentNode.y : PADDING_Y;

    nodes.forEach((node, i) => {
      const x = PADDING_X + BRANCH_OFFSET * (branchIdx);
      const y = startY + i * ROW_H;
      laid.push({ id: node.id, x, y, node });
      nodeMap.set(node.id, { x, y, node });
    });
  });

  const maxX = Math.max(...laid.map((l) => l.x)) + PADDING_X + 40;
  const maxY = Math.max(...laid.map((l) => l.y)) + PADDING_Y + 40;

  const commitMap = new Map<string, CommitNodeType>();
  commits.forEach((c) => commitMap.set(c.id, c));

  function getEdgePath(from: { x: number; y: number }, to: { x: number; y: number }, type: string) {
    if (from.x === to.x) {
      // Same column: straight vertical
      return `M ${from.x} ${from.y} L ${to.x} ${to.y}`;
    }
    // Branch/merge: curve
    const midY = (from.y + to.y) / 2;
    return `M ${from.x} ${from.y} C ${from.x} ${midY}, ${to.x} ${midY}, ${to.x} ${to.y}`;
  }

  return (
    <svg
      width={maxX}
      height={maxY}
      className="block"
      role="img"
      aria-label="Thread tree graph"
    >
      {/* Edges */}
      {tree.edges.map((edge) => {
        const fromPos = nodeMap.get(edge.from);
        const toPos = nodeMap.get(edge.to);
        if (!fromPos || !toPos) return null;
        const isDashed = edge.type === 'branch';
        const color = edge.type === 'merge' ? '#3fb950' : '#30363d';
        return (
          <path
            key={`${edge.from}-${edge.to}`}
            d={getEdgePath(fromPos, toPos, edge.type)}
            fill="none"
            stroke={color}
            strokeWidth={2}
            strokeDasharray={isDashed ? '6,4' : undefined}
          />
        );
      })}

      {/* Nodes */}
      {laid.map(({ id, x, y, node }) => {
        const commit = commitMap.get(id);
        const isSelected = selectedId === id;
        const isRegret = node.regret || commit?.regret;
        const branchColor = node.branchId ? branchColorMap.get(node.branchId) ?? '#58a6ff' : '#e6edf3';

        return (
          <g
            key={id}
            onClick={() => onSelectNode?.(id)}
            className="cursor-pointer"
            role="button"
            aria-label={`Commit ${id}`}
          >
            <circle
              cx={x}
              cy={y}
              r={NODE_R}
              fill={isRegret ? '#d29922' : isSelected ? branchColor : '#161b22'}
              stroke={branchColor}
              strokeWidth={isSelected ? 3 : 2}
            />
            {isRegret && (
              <text x={x} y={y + 1} textAnchor="middle" dominantBaseline="middle" fill="#0d1117" fontSize={12} fontWeight="bold">
                !
              </text>
            )}
            {node.contextLabel && (
              <text x={x + 18} y={y + 4} fill="#8b949e" fontSize={11} className="mono">
                {node.contextLabel}
              </text>
            )}
            {commit && !node.contextLabel && (
              <text x={x + 18} y={y + 4} fill="#8b949e" fontSize={11}>
                {commit.verdictSummary.slice(0, 40)}{commit.verdictSummary.length > 40 ? '…' : ''}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
