"""A small, editable Manim lesson. Run: uv run manim -ql bubble_sort.py Explained"""
from manim import *

VALUES = [5, 2, 4, 1, 3]
FONT = "Apple SD Gothic Neo"  # Choose an installed Korean font on your OS.
BLUE = "#589BFF"
INK = "#F5F2EB"
IDLE = "#3B4B65"


class BubbleLesson(Scene):
    explain = True
    swap_seconds = 0.9
    pause_seconds = 0.65

    def construct(self):
        self.camera.background_color = "#0B0D12"
        title = Text("비교하고, 교환하고", font=FONT, font_size=48, color=INK).to_edge(UP)
        action = Text("시작", font=FONT, font_size=30, color=BLUE).shift(UP*1.9)
        self.add(title)
        if self.explain:
            self.add(action)
        values = VALUES.copy()
        bars = []
        for i, value in enumerate(values):
            bar = Rectangle(width=.8, height=value*.48, stroke_width=0,
                            fill_color=IDLE, fill_opacity=1)
            bar.move_to([(i-2)*1.4, -2+bar.height/2, 0])
            number = Text(str(value), font=FONT, font_size=32, color=INK).next_to(bar, UP, buff=.15)
            bars.append(VGroup(bar, number))
        self.play(*[FadeIn(g, shift=UP*.15) for g in bars], run_time=.6)
        for end in range(len(values)-1, 0, -1):
            for i in range(end):
                if self.explain:
                    label = Text(f"{values[i]}와 {values[i+1]} 비교", font=FONT, font_size=30, color=BLUE).move_to(action)
                    self.play(Transform(action, label), bars[i][0].animate.set_fill(BLUE),
                              bars[i+1][0].animate.set_fill(BLUE), run_time=.25)
                    self.wait(self.pause_seconds)
                if values[i] > values[i+1]:
                    if self.explain:
                        self.play(Transform(action, Text("왼쪽이 크니까, 교환", font=FONT,
                                  font_size=30, color=BLUE).move_to(action)), run_time=.2)
                    self.play(bars[i].animate(path_arc=-PI/5).shift(RIGHT*1.4),
                              bars[i+1].animate(path_arc=-PI/5).shift(LEFT*1.4),
                              run_time=self.swap_seconds)
                    bars[i], bars[i+1] = bars[i+1], bars[i]
                    values[i], values[i+1] = values[i+1], values[i]
                if self.explain:
                    self.play(bars[i][0].animate.set_fill(IDLE), bars[i+1][0].animate.set_fill(IDLE), run_time=.2)
        assert values == sorted(VALUES)
        assert all(bars[i].get_center()[0] < bars[i+1].get_center()[0] for i in range(len(bars)-1))
        self.play(*[g[0].animate.set_fill(BLUE) for g in bars], run_time=.5)
        if self.explain:
            self.play(Transform(action, Text("정렬 완료", font=FONT, font_size=30, color=BLUE).move_to(action)), run_time=.3)
        self.wait(1.5)


class Plain(BubbleLesson):
    explain = False
    swap_seconds = .25


class Explained(BubbleLesson):
    pass
