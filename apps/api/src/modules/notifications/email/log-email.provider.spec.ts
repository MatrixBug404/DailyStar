import { Logger } from '@nestjs/common';
import { LogEmailProvider } from './log-email.provider';

describe('LogEmailProvider', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('resolves without network I/O', async () => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const provider = new LogEmailProvider();

    await expect(
      provider.send({
        to: 'recipient@dailystar.local',
        subject: '[DailyStar] Article approved',
        text: 'Notification body',
        notificationId: 'notification-1',
      }),
    ).resolves.toBeUndefined();
  });

  it('logs recipient, subject and correlation id but never the message body', async () => {
    const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const provider = new LogEmailProvider();

    await provider.send({
      to: 'recipient@dailystar.local',
      subject: '[DailyStar] Article approved',
      text: 'sensitive editorial body',
      notificationId: 'notification-1',
    });

    expect(logSpy).toHaveBeenCalledTimes(1);
    const line = String(logSpy.mock.calls[0][0]);
    expect(line).toContain('notificationId=notification-1');
    expect(line).toContain('to=recipient@dailystar.local');
    expect(line).toContain('subject="[DailyStar] Article approved"');
    expect(line).not.toContain('sensitive editorial body');
  });
});
