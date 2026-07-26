import * as fs from 'fs';
import * as path from 'path';

export class PackageStore {
  private runDirectory: string;

  constructor(runId: string) {
    const runsPath = path.join(__dirname, '..', 'runs');
    if (!fs.existsSync(runsPath)) {
      fs.mkdirSync(runsPath, { recursive: true });
    }
    this.runDirectory = path.join(runsPath, runId);
    if (!fs.existsSync(this.runDirectory)) {
      fs.mkdirSync(this.runDirectory, { recursive: true });
    }
  }

  savePackage(stepNumber: string, agentName: string, packageData: any): void {
    const filename = `${stepNumber}_${agentName}.json`;
    const filepath = path.join(this.runDirectory, filename);
    fs.writeFileSync(filepath, JSON.stringify(packageData, null, 2), 'utf-8');
  }

  loadPackage(filename: string): any {
    const filepath = path.join(this.runDirectory, filename);
    if (fs.existsSync(filepath)) {
      const data = fs.readFileSync(filepath, 'utf-8');
      return JSON.parse(data);
    }
    return null;
  }
}
