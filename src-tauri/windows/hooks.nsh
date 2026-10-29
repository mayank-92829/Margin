; Adds "Edit with Margin" to the Explorer right-click menu for every file type.

!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr HKCU "Software\Classes\*\shell\EditWithMargin" "" "Edit with Margin"
  WriteRegStr HKCU "Software\Classes\*\shell\EditWithMargin" "Icon" "$INSTDIR\${MAINBINARYNAME}.exe,0"
  WriteRegStr HKCU "Software\Classes\*\shell\EditWithMargin\command" "" '"$INSTDIR\${MAINBINARYNAME}.exe" "%1"'
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  DeleteRegKey HKCU "Software\Classes\*\shell\EditWithMargin"
!macroend
