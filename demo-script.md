# Trace Hackathon Demo Script

**Target length:** 2 minutes 45 seconds  
**Format:** Screen recording with voiceover  
**Core message:** Trace is Git for research decisions in any field. It automatically captures the evidence behind a decision, preserves how the answer changed, and resurfaces that history when the decision matters again. Qoder demonstrates one powerful integration, not the limit of the product.

## Before recording

- Start Trace with `./scripts/start.sh` and confirm the menu bar says browser capture is online.
- Open the Trace dashboard, Chrome, and Qoder before recording.
- In Qoder, run `/mcp reload` if the Trace MCP tools are not already connected.
- Open **DECISION/b991fc3 — Evaluate whether DenseNet-121 is the best model** in Trace.
- Keep one genuine DenseNet-versus-ResNet paper or benchmark page ready in Chrome—for example, the “ResNet or DenseNet?” paper already represented in this decision. Close private tabs and disable notifications.
- Stage this Qoder Agent Mode prompt, but do not submit it yet:

  > Before I set DenseNet-121 as the default architecture in this image-classification project, use Trace to inspect my prior research. Tell me the current answer, the relevant constraints and unresolved comparisons, and any recorded outcome or regret. End with what I should verify before changing the code.

- Do one rehearsal. Aim for a calm pace of roughly 125–135 spoken words per minute.

## Timed script

| Time | What viewers should see | Voiceover |
|---|---|---|
| **0:00–0:12** | Begin on a browser with several research tabs. Briefly move between two comparison pages, then pause on the crowded tab bar. | “Whenever we research an important decision—a model, treatment, product, vendor, methodology, or strategy—we open many sources, reach a conclusion, and eventually forget why. Later, when we revisit the same choice, we often start the research from zero.” |
| **0:12–0:27** | Switch to Trace’s Decisions index. Let the list remain visible, then open **DECISION/b991fc3 — Evaluate whether DenseNet-121 is the best model**. | “Trace solves that by treating research like Git. Every recurring decision has evidence, commits, branches, outcomes, and a current answer—not just a pile of bookmarks. This model-selection example is one use case.” |
| **0:27–0:45** | Switch to Chrome and visit the prepared research page. Show the Trace menu-bar status as **Capture online**, then return to Trace. If the new event has already arrived, briefly show it at the top of Activity or the current session node. | “While I browse, Trace works automatically. The local service detects research intent, captures the visible page when it is safe, extracts its context, ignores ordinary browsing, and routes useful evidence in roughly ten seconds.” |
| **0:45–1:12** | On the decision canvas, slowly pan from an earlier checkpoint to **Current answer**. Click a node so its evidence and screenshot thumbnails appear. Open one thumbnail briefly, close it, then continue across the graph. | “This map is the actual research story. I can see what I believed at each checkpoint, the sources and screenshots behind it, and the answer Trace currently recommends. The screenshot is stored locally, and my configured AI can use it as context to understand the evidence.” |
| **1:12–1:35** | Pan across the DenseNet checkpoint sequence into the resolved **Current answer**. Then show **You left off here** and the live comparison area. Hover or click only long enough to make each label readable. | “As more sources arrive, Trace adds checkpoints to the same decision instead of creating duplicates. It commits an actionable answer while keeping the remaining benchmark questions visible. I can see exactly where I stopped and continue from the unresolved comparison instead of starting again.” |
| **1:35–1:52** | Show the **Outcome review** node. Select **Worked**, **Mixed**, **Regretted**, or **Superseded**—preferably **Mixed** with a short note such as “Strong baseline, but ResNet won on latency.” Briefly show the **Manual override** button without opening it. | “A decision is not finished when it is made. Trace records whether it worked, was mixed, was regretted, or was superseded. Branch reconciliation remains automatic; the visible button is only a manual override.” |
| **1:52–2:24** | Switch to Qoder and submit the staged DenseNet prompt. Keep the tool-call area visible so viewers can see `search_decisions`, `get_decision_trace`, `get_current_answer`, and `get_relevant_constraints`. Finish on Qoder’s concise conclusion: DenseNet-121 is not yet established as best, and should be benchmarked against ResNet and dense-shortcut ResNet on the target task before the code changes. | “For developers, Trace can meet us where the next decision happens. Through a read-only MCP server, Qoder searches my history autonomously. It discovers that DenseNet-121 was never established as best, recovers the target-task constraints, and warns me to compare it with ResNet alternatives before changing the code. This is one integration of a decision memory that can support any research workflow.” |
| **2:24–2:45** | Return to the full Trace map and slowly zoom out so the complete research story is visible. End on the Trace logo and current answer/outcome path. | “Trace turns browsing into durable decision memory: automatic capture, explainable AI routing, visual evidence, branches, outcomes, and resurfacing when context matters. Whether the question is technical, academic, commercial, or personal, the next time it returns, I don’t restart from zero—I continue from exactly where my reasoning left off.” |

## Recording notes

- Keep the pointer still while speaking; move only when the next visual is mentioned.
- Use deliberate pans rather than rapidly zooming around the map.
- Do not wait silently for live AI. Visit the research page at **0:27**, continue the explanation, and reveal the result after it arrives.
- If Qoder takes longer than expected, record that segment separately and cut the waiting time while keeping the tool calls and final answer visible.
- Never show `.env`, API keys, terminal environment variables, private browser tabs, or personal messages.
- Keep the words **Current answer**, **Verdict committed**, **You left off here**, **Outcome review**, and the MCP tool names readable; they communicate the product faster than extra narration.

## Optional cuts

If the video must be closer to two minutes:

- Remove the screenshot lightbox interaction: save about 8 seconds.
- Show the outcome node without entering a note: save about 7 seconds.
- Shorten the final Qoder answer to one sentence: save about 12 seconds.

Do not cut the Qoder segment; it directly demonstrates agentic use of Qoder, workflow reuse, and Trace’s value outside its own dashboard.
