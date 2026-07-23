@echo off
REM One checkpointed pass of the NCERT G7-12 content pipeline, fired by Windows
REM Task Scheduler every 20 min. Checkpointed + single-instance locked, so a
REM new fire is safe even if a previous pass is still running or was killed.
cd /d C:\Users\Asus\Downloads\Aivorah\Aivorah\server
node scripts\orchestrate-ncert.js --list data\curricula\ncert_catalog\english_medium.txt --grades 7,8,9,10,11,12 --lite >> data\curricula\ncert_catalog\autopass.log 2>&1
node scripts\check-pipeline-complete.js >> data\curricula\ncert_catalog\autopass.log 2>&1
