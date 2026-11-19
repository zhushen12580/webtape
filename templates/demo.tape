# WebTape demo. Record it with: webtape run demo.tape
Output demo.gif
Viewport 1280 720
Set Framerate 20
Set Theme light
Set TypingSpeed 50ms

Goto demo.html
Wait "#new-todo"
Sleep 500ms
Click "#new-todo"
Type "Record a demo with WebTape"
Press Enter
Sleep 500ms
Click "#save"
Wait "text=Saved"
Sleep 1s
Scroll "#todo-list" 240
Sleep 500ms
Scroll 400
Sleep 1s
