Option Explicit

Dim shell, fileSystem, projectDirectory, projectRoot, npmCommand, pythonScript, command, exitCode
Set shell = CreateObject("WScript.Shell")
Set fileSystem = CreateObject("Scripting.FileSystemObject")

projectDirectory = fileSystem.GetParentFolderName(WScript.ScriptFullName)
projectRoot = fileSystem.GetParentFolderName(projectDirectory)
npmCommand = "C:\Program Files\nodejs\npm.cmd"
pythonScript = projectRoot & "\server\serve-local.py"
shell.CurrentDirectory = projectDirectory

If Not fileSystem.FileExists(npmCommand) Then
  MsgBox "No se encontro npm en C:\Program Files\nodejs. Instala Node.js para compilar Pyme360.", vbExclamation, "Pyme360 TypeScript"
  WScript.Quit 1
End If
If Not fileSystem.FileExists(pythonScript) Then
  MsgBox "No se encontro el servidor local de Pyme360 en la carpeta del proyecto.", vbExclamation, "Pyme360 TypeScript"
  WScript.Quit 1
End If

command = "cmd.exe /d /c call """ & npmCommand & """ run build"
exitCode = shell.Run(command, 0, True)
If exitCode <> 0 Then
  MsgBox "No se pudo compilar el modelo TypeScript. En la primera ejecucion, instala las dependencias con npm install y vuelve a iniciar.", vbExclamation, "Pyme360 TypeScript"
  WScript.Quit exitCode
End If

If shell.Run("cmd.exe /d /c where py.exe >nul 2>&1", 0, True) = 0 Then
  command = "cmd.exe /d /c py -3 """ & pythonScript & """ --app typescript-model"
ElseIf shell.Run("cmd.exe /d /c where python.exe >nul 2>&1", 0, True) = 0 Then
  command = "cmd.exe /d /c python """ & pythonScript & """ --app typescript-model"
Else
  MsgBox "No se encontro Python 3.11 o superior. Instala Python y vuelve a iniciar Pyme360.", vbExclamation, "Pyme360 TypeScript"
  WScript.Quit 1
End If

shell.Run command, 0, False
