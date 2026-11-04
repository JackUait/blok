// C# registers one agent executor beside the documents runtime, with the
// rooms only when collaboration is on (BlokDocumentsServiceCollectionExtensions.cs:79-86),
// and its HTML reader takes that same runtime (BlokServerServiceCollectionExtensions.cs:164).

#[test]
#[ignore = "AgentExecutor needs blokagent's room parts, which the agent lane is adding"]
fn the_agent_executor_edits_the_servers_own_rooms_on_one_engine_pool() {}

#[test]
#[ignore = "AgentExecutor needs blokagent's room parts, which the agent lane is adding"]
fn the_agent_executor_without_collaboration_has_no_rooms() {}
