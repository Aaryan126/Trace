# Trace Hackathon Demo Script

**Target length:** 2 minutes 45 seconds  
**Format:** Screen recording with voiceover  
**Core message:** Trace is Git for research decisions in any field. It automatically captures the evidence behind a decision, preserves how the answer changed, and resurfaces that history when the decision matters again. Qoder demonstrates one powerful integration, not the limit of the product.

## Before recording

- Start Trace with `./scripts/start.sh` and confirm the menu bar says browser capture is online.
- Open the Trace dashboard, Chrome, and Qoder before recording.
- In Qoder, run `/mcp reload` if the Trace MCP tools are not already connected.
- Open **DECISION/b991fc3 — Evaluate whether DenseNet-121 is the best model** in Trace.
- Copy this new, not-yet-visited page URL so it is ready to paste during recording: `https://docs.pytorch.org/vision/stable/models/generated/torchvision.models.densenet121.html`. It contains concrete DenseNet-121 accuracy, parameter-count, and GFLOPS evidence. Do not load it before the final take, because a rehearsal visit within 30 minutes will be intentionally deduplicated. Close private tabs and disable notifications.
- Stage this Qoder Agent Mode prompt, but do not submit it yet:

  > Before I set DenseNet-121 as the default architecture in this image-classification project, use Trace to inspect my prior research. Tell me the current answer, the relevant constraints and unresolved comparisons, and any recorded outcome or regret. End with what I should verify before changing the code.

- Do one rehearsal. Aim for a calm pace of roughly 125–135 spoken words per minute.

## Timed script

| Time | What viewers should see | Voiceover |
|---|---|---|
| **0:00–0:12** | Begin on a browser with several research tabs. Briefly move between two comparison pages, then pause on the crowded tab bar. | “Whenever we research an important decision—a model, treatment, product, vendor, methodology, or strategy—we open many sources, reach a conclusion, and eventually forget why. Later, when we revisit the same choice, we often start the research from zero.” |
| **0:12–0:27** | Switch to Trace’s Decisions index. Let the list remain visible, then open **DECISION/b991fc3 — Evaluate whether DenseNet-121 is the best model**. | “Trace solves that by treating research like Git. Every recurring decision has evidence, commits, branches, outcomes, and a current answer—not just a pile of bookmarks. This model-selection example is one use case.” |
| **0:27–0:45** | Switch to a fresh Chrome tab, paste the prepared PyTorch DenseNet-121 URL, and press Enter. Stay on the page for at least three seconds; scroll just enough to show its accuracy, parameter-count, and GFLOPS table. Return to Trace, point to **Capture online** in the top-right, and click it to open **Live Trace**. Under **Recent automation** or **Working research**, show the new DenseNet item if it has arrived; otherwise close the drawer and continue to the DenseNet map, which updates automatically. Do not wait silently. | “While I browse, Trace works automatically. The local service detects research intent, captures the visible page when it is safe, extracts its context, ignores ordinary browsing, and routes useful evidence in roughly ten seconds.” |
| **0:45–1:12** | On the decision canvas, slowly pan from an earlier checkpoint to **Current answer**. Click a node so its evidence and screenshot thumbnails appear. Open one thumbnail briefly, close it, then continue across the graph. | “This map is the actual research story. I can see what I believed at each checkpoint, the sources and screenshots behind it, and the answer Trace currently recommends. The screenshot is stored locally, and my configured AI can use it as context to understand the evidence.” |
| **1:12–1:35** | Move from the resolved **Current answer** to **You left off here**. Keep its next question and resumable pages readable, then show **Live comparison** and click **Expand** so the option-by-criterion matrix is clear. | “Trace does not just preserve the answer. ‘You left off here’ turns what is still unresolved into a clear next question and keeps the exact pages I need to resume. The live comparison organizes what each source says about every option, while making the remaining unknowns visible. So I know what we have learned, what is missing, and exactly where to continue.” |
| **1:35–1:52** | Show the **Outcome review** node. Select **Worked**, **Mixed**, **Regretted**, or **Superseded**—preferably **Mixed** with a short note such as “Strong baseline, but ResNet won on latency.” Briefly show the **Manual override** button without opening it. | “A decision is not finished when it is made. Trace records whether it worked, was mixed, was regretted, or was superseded. Branch reconciliation remains automatic; the visible button is only a manual override.” |
| **1:52–2:24** | Switch to Qoder and submit the staged DenseNet prompt. Keep the Trace MCP tool calls visible, then finish on Qoder’s recommendation to retain ResNet as the default and benchmark DenseNet-121 as a challenger under controlled conditions. | “Trace also brings this decision memory into other tools through a read-only MCP connection. Here, Qoder searches my earlier DenseNet research before a code change, retrieves the answers and constraints, and notices the mixed outcome: ResNet performed better on latency. It keeps ResNet as the default and treats DenseNet-121 as a challenger, requiring controlled benchmarks of performance, latency, and memory. Qoder is reasoning from my actual experience, not starting again.” |
| **2:24–2:45** | Return to Trace and click **Fit story**. Let the complete map settle with its evidence, current answer, outcome, live comparison, and **You left off here** path visible. Finish with the Trace logo and full research story on screen. | “Trace turns scattered browsing into a living decision history. It captures evidence automatically, shows how the answer evolved, records what happened after the decision, and brings that context into the tools where the next choice is made. So I don’t repeat my research—I continue from it. Trace is Git for decisions.” |

## Recording notes

- Keep the pointer still while speaking; move only when the next visual is mentioned.
- Use deliberate pans rather than rapidly zooming around the map.
- Do not wait silently for live AI. Visit the research page at **0:27**, continue the explanation, and reveal the result after it arrives.
- Use **Live Trace**, opened by clicking **Capture online**, for the immediate routing result. Activity is a checkpoint audit and may update later.
- Do not open the prepared PyTorch URL during rehearsal. If you must test the full capture flow, rehearse with a different relevant URL so the final page is not suppressed by the 30-minute duplicate window.
- If Qoder takes longer than expected, record that segment separately and cut the waiting time while keeping the tool calls and final answer visible.
- Never show `.env`, API keys, terminal environment variables, private browser tabs, or personal messages.
- Keep the words **Current answer**, **Verdict committed**, **You left off here**, **Outcome review**, and the MCP tool names readable; they communicate the product faster than extra narration.

## Optional cuts

If the video must be closer to two minutes:

- Remove the screenshot lightbox interaction: save about 8 seconds.
- Show the outcome node without entering a note: save about 7 seconds.
- Shorten the final Qoder answer to one sentence: save about 12 seconds.

Do not cut the Qoder segment; it directly demonstrates agentic use of Qoder, workflow reuse, and Trace’s value outside its own dashboard.
