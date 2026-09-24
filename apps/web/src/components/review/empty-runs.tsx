import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

const COMMANDS = `pnpm visual:capture -- --run-id <id> --kind baseline --base-url <storybook-url> --targets <manifest>
pnpm visual:capture -- --run-id <id> --kind current --base-url <storybook-url> --targets <manifest>
pnpm visual:compare -- --run-id <id> --repository <name> --base-sha <sha> --head-sha <sha> --targets <manifest>`;

/** run이 하나도 없을 때. 가짜 run을 만들어 보여주는 대신 만드는 명령을 안내한다. */
export function EmptyRuns({ dataDir }: { dataDir: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>No visual runs yet</h2>
        </CardTitle>
        <CardDescription>
          Nothing was found in <code className="font-mono break-all">{dataDir}/runs</code>. Create a
          run from the repository root:
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <pre className="overflow-x-auto rounded-lg bg-muted p-4 font-mono text-sm">{COMMANDS}</pre>
        <p className="text-sm text-muted-foreground">
          To browse the bundled fixture instead, start the app with{' '}
          <code className="font-mono">REVIEW_DATA_DIR=fixtures/visual/review-data</code>.
        </p>
      </CardContent>
    </Card>
  );
}
