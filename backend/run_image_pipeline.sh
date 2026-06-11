#!/bin/bash
# Full NCERT image pipeline — run once, completes automatically
# Phase 1: Upload all grades to Cloudinary (resumes from checkpoint)
# Phase 2: Groq Vision captions + Qdrant ingestion (chained automatically)
#
# Usage:
#   bash run_image_pipeline.sh              # all grades 6-12
#   bash run_image_pipeline.sh 6 7 8        # specific grades

cd "$(dirname "$0")"

GRADES="${@:-6 7 8 9 10 11 12}"
LOG_DIR="../server/data/ncert_image_jsonl"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
LOG_FILE="$LOG_DIR/pipeline_${TIMESTAMP}.log"

echo "========================================"
echo " NCERT Image Pipeline — $(date)"
echo " Grades: $GRADES"
echo " Log: $LOG_FILE"
echo "========================================"

python scripts/ncert_upload_images.py --grades $GRADES --chain-pipeline 2>&1 | tee "$LOG_FILE"

echo ""
echo "========================================"
echo " Pipeline complete — $(date)"
echo "========================================"
