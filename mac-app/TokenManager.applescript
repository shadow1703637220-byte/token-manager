-- Local Token Manager launcher v1.0.2 (AppleScript applet shell)
-- Build on a Mac (payload comes from `node build-dist.js mac` on any machine):
--   osacompile -s -o TokenManager.app TokenManager.applescript
--   cp payload/node payload/server.js TokenManager.app/Contents/Resources/
--   cp payload/applet.icns TokenManager.app/Contents/Resources/applet.icns
--   (optional) set CFBundleName in Contents/Info.plist, then zip the .app
-- A real application process: Dock icon stays while running,
-- and choosing Quit from the Dock stops the server.
-- Server binary and data are unchanged:
--   Contents/Resources/node + server.js (dist build, TM_DIST=1)
--   Data: ~/Library/Application Support/TokenManager/data.json

property serverURL : "http://127.0.0.1:3210/"
property chromeAppPath : "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
property startedServer : false

on run
	set bundlePath to POSIX path of (path to me)
	set resPath to bundlePath & "Contents/Resources/"
	set nodeBin to resPath & "node"
	set serverJS to resPath & "server.js"
	set logPath to (POSIX path of (path to home folder)) & "Library/Logs/TokenManager.log"

	-- An instance is already serving: just show the page, then quit.
	-- (startedServer stays false, so our quit handler will NOT kill it.)
	if serverUp() then
		do shell script "open '" & serverURL & "?t='$(date +%s)"
		quit
		return
	end if

	-- Start the server detached; this applet stays open as its Dock owner.
	set startedServer to true
	do shell script "TM_DIST=1 TM_NO_BROWSER=1 nohup " & quoted form of nodeBin & " " & quoted form of serverJS & " >> " & quoted form of logPath & " 2>&1 &"

	-- Wait until the server answers (up to ~10 seconds).
	repeat 40 times
		if serverUp() then exit repeat
		delay 0.25
	end repeat

	-- Open the UI: Chrome app-mode window when Chrome exists, else default browser.
	if chromeExists() then
		try
			do shell script "'" & chromeAppPath & "' --app='" & serverURL & "?t='$(date +%s) >/dev/null 2>&1 &"
		on error
			do shell script "open '" & serverURL & "?t='$(date +%s)"
		end try
	else
		do shell script "open '" & serverURL & "?t='$(date +%s)"
	end if
end run

on quit
	-- Only stop the server if THIS applet instance started it.
	if startedServer then
		try
			do shell script "lsof -ti:3210 | xargs kill 2>/dev/null; exit 0"
		end try
	end if
	continue quit
end quit

on serverUp()
	try
		do shell script "curl -s -o /dev/null --max-time 2 " & serverURL
		return true
	on error
		return false
	end try
end serverUp

on chromeExists()
	try
		do shell script "test -d '/Applications/Google Chrome.app'"
		return true
	on error
		return false
	end try
end chromeExists
