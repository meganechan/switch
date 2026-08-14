"""Capture a real AG-UI tool-calling cycle from LangGraph."""

import asyncio
import pathlib
import sys
from typing import Annotated, TypedDict

from ag_ui.core import RunAgentInput, Tool, UserMessage
from ag_ui_langgraph import LangGraphAgent
from langchain_core.messages import AIMessage
from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, START, StateGraph
from langgraph.graph.message import add_messages


class S(TypedDict):
    messages: Annotated[list, add_messages]


async def respond(state: S):
    # A model that decides to call a client-executed tool.
    return {
        "messages": [
            AIMessage(
                content="",
                tool_calls=[
                    {
                        "name": "post_message",
                        "args": {"body": "status is green"},
                        "id": "call-1",
                    }
                ],
            )
        ]
    }


builder = StateGraph(S)
builder.add_node("respond", respond)
builder.add_edge(START, "respond")
builder.add_edge("respond", END)
graph = builder.compile(checkpointer=MemorySaver())


async def main():
    agent = LangGraphAgent(name="probe", graph=graph)
    run_input = RunAgentInput(
        thread_id="t1",
        run_id="r1",
        state={},
        messages=[UserMessage(id="u1", role="user", content="post the status")],
        tools=[
            Tool(
                name="post_message",
                description="Post a message to the room.",
                parameters={
                    "type": "object",
                    "properties": {"body": {"type": "string"}},
                },
            )
        ],
        context=[],
        forwarded_props={},
    )
    frames = []
    async for e in agent.run(run_input):
        frames.append(
            e
            if isinstance(e, str)
            else e.model_dump_json(by_alias=True, exclude_none=True)
        )
    text = "".join(f if f.startswith("data:") else f"data: {f}\n\n" for f in frames)
    pathlib.Path(sys.argv[1]).write_text(text)

    import collections
    import json

    types = collections.Counter(
        json.loads(line[6:])["type"]
        for line in text.splitlines()
        if line.startswith("data: ")
    )
    print(f"captured {len(frames)} frames")
    for t, n in types.most_common():
        print(f"   {t:<26} x{n}")


asyncio.run(main())
