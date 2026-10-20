/**
 * 自動読み取りの直列実行。実行中に再要求が来たら取りこぼさず、終了後に最新の状態で1回だけ再実行する
 * （読み取り中にタブを切り替えても、表示中のタブの状態が古いまま残らない）。
 */
export function createCoalescingRunner(task: () => Promise<void>) {
  let current: Promise<void> | null = null;
  let rerun = false;

  const start = () => {
    current = task()
      .catch(() => undefined)
      .then(() => {
        if (rerun) {
          rerun = false;
          start();
        } else {
          current = null;
        }
      });
  };

  return {
    request(): void {
      if (current) rerun = true;
      else start();
    },
    /** 実行中の読み取り（再実行を含む）がすべて終わるまで待つ。 */
    async idle(): Promise<void> {
      while (current) await current;
    },
  };
}
