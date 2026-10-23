import { Test, TestingModule } from '@nestjs/testing';
import { SchedulingProcessor } from './scheduling.processor';
import { WorkflowService, TerminalPublicationError } from '../workflow/workflow.service';

describe('SchedulingProcessor (Unit)', () => {
  let processor: SchedulingProcessor;
  let mockWorkflowService: any;

  beforeEach(async () => {
    mockWorkflowService = {
      executeScheduledPublish: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SchedulingProcessor,
        {
          provide: WorkflowService,
          useValue: mockWorkflowService,
        },
      ],
    }).compile();

    processor = module.get<SchedulingProcessor>(SchedulingProcessor);
  });

  it('should process scheduled publish job successfully', async () => {
    const job: any = { id: 'job-1', data: { scheduleId: 'sched-1' } };
    mockWorkflowService.executeScheduledPublish.mockResolvedValue({ id: 'art-1', status: 'PUBLISHED' });

    const result = await processor.process(job);

    expect(mockWorkflowService.executeScheduledPublish).toHaveBeenCalledWith('sched-1');
    expect(result).toEqual({ status: 'published', articleId: 'art-1' });
  });

  it('should return explicit terminal result on TerminalPublicationError without throwing', async () => {
    const job: any = { id: 'job-1', data: { scheduleId: 'sched-1' } };
    mockWorkflowService.executeScheduledPublish.mockRejectedValue(
      new TerminalPublicationError('VERSION_MISMATCH'),
    );

    const result = await processor.process(job);

    expect(result).toEqual({ status: 'terminal_failure', reason: 'VERSION_MISMATCH' });
  });

  it('should re-throw untyped errors even when their text resembles a business rejection', async () => {
    const job: any = { id: 'job-1', data: { scheduleId: 'sched-1' } };
    mockWorkflowService.executeScheduledPublish.mockRejectedValue(
      new Error('REVISION_MISMATCH'),
    );

    await expect(processor.process(job)).rejects.toThrow('REVISION_MISMATCH');
  });

  it('should re-throw transient database/infrastructure errors to allow BullMQ retry', async () => {
    const job: any = { id: 'job-1', data: { scheduleId: 'sched-1' } };
    mockWorkflowService.executeScheduledPublish.mockRejectedValue(
      new Error('Connection reset by peer'),
    );

    await expect(processor.process(job)).rejects.toThrow('Connection reset by peer');
  });

  it.each([
    'Invalid `prisma.article.update()` invocation',
    'Record to update not found',
    'CANCELLED upstream by proxy',
    'VERSION_MISMATCH while reading from the primary',
    'no longer PENDING in a stale replica',
  ])('should re-throw terminal-looking text that is not a TerminalPublicationError: %s', async (message) => {
    const job: any = { id: 'job-1', data: { scheduleId: 'sched-1' } };
    mockWorkflowService.executeScheduledPublish.mockRejectedValue(new Error(message));

    await expect(processor.process(job)).rejects.toThrow(message);
  });

  it('should re-throw plain errors carrying only an isTerminal flag', async () => {
    const job: any = { id: 'job-1', data: { scheduleId: 'sched-1' } };
    const error: any = new Error('untyped terminal marker');
    error.isTerminal = true;
    mockWorkflowService.executeScheduledPublish.mockRejectedValue(error);

    await expect(processor.process(job)).rejects.toThrow('untyped terminal marker');
  });
});
