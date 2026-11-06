using Blok.Mcp;

// stdout carries the protocol: nothing else may write there.
var stdout = Console.Out;

Console.SetOut(Console.Error);

return await BlokMcpCli.RunAsync(args, stdout);
