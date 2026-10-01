' Starts the Agentic OS desktop app (Electron) with no console window.
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = dir
' When launched from inside VS Code this is inherited and makes electron.exe behave as plain Node.
On Error Resume Next
sh.Environment("Process").Remove "ELECTRON_RUN_AS_NODE"
On Error GoTo 0
sh.Run """" & dir & "\node_modules\electron\dist\electron.exe"" """ & dir & """", 1, False
