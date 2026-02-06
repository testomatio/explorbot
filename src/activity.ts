export interface ActivityEntry {
  message: string;
  timestamp: Date;
  type?: 'ai' | 'action' | 'navigation' | 'general';
}

type ActivityListener = (activity: ActivityEntry | null) => void;

class Activity {
  private static instance: Activity;
  private currentActivity: ActivityEntry | null = null;
  private listeners: ActivityListener[] = [];
  private clearTimeoutId: NodeJS.Timeout | null = null;

  private constructor() {}

  static getInstance(): Activity {
    if (!Activity.instance) {
      Activity.instance = new Activity();
    }
    return Activity.instance;
  }

  setActivity(message: string, type: ActivityEntry['type'] = 'general'): void {
    // Clear any pending clear timeout
    if (this.clearTimeoutId) {
      clearTimeout(this.clearTimeoutId);
      this.clearTimeoutId = null;
    }

    this.currentActivity = {
      message,
      timestamp: new Date(),
      type,
    };
    this.notifyListeners();
  }

  clearActivity(force = false): void {
    if (this.clearTimeoutId) {
      clearTimeout(this.clearTimeoutId);
      this.clearTimeoutId = null;
    }

    if (force) {
      this.currentActivity = null;
      this.notifyListeners();
      return;
    }

    if (this.currentActivity) {
      const timeSinceActivity = Date.now() - this.currentActivity.timestamp.getTime();
      const minDisplayTime = 1000;

      if (timeSinceActivity < minDisplayTime) {
        this.clearTimeoutId = setTimeout(() => {
          this.currentActivity = null;
          this.notifyListeners();
          this.clearTimeoutId = null;
        }, minDisplayTime - timeSinceActivity);
      } else {
        this.currentActivity = null;
        this.notifyListeners();
      }
    }
  }

  getCurrentActivity(): ActivityEntry | null {
    return this.currentActivity;
  }

  addListener(listener: ActivityListener): void {
    this.listeners.push(listener);
    listener(this.currentActivity);
  }

  removeListener(listener: ActivityListener): void {
    const index = this.listeners.indexOf(listener);
    if (index > -1) {
      this.listeners.splice(index, 1);
    }
  }

  private notifyListeners(): void {
    this.listeners.forEach((listener) => listener(this.currentActivity));
  }
}

const activity = Activity.getInstance();

export const setActivity = (message: string, type: ActivityEntry['type'] = 'general') => {
  activity.setActivity(message, type);
};

export const clearActivity = (force = false) => {
  activity?.clearActivity(force);
};

export const getCurrentActivity = () => {
  return activity.getCurrentActivity();
};

export const addActivityListener = (listener: ActivityListener) => {
  activity.addListener(listener);
};

export const removeActivityListener = (listener: ActivityListener) => {
  activity.removeListener(listener);
};

export default Activity;
