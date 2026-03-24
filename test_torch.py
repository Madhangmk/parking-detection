import torch
print(torch.__version__)
import torch.nn
print("torch.nn imported")
try:
    import torch.ao.nn.intrinsic.quantized.dynamic.modules
    print("torch.ao.nn.intrinsic.quantized.dynamic.modules imported")
except ImportError as e:
    print(f"ImportError: {e}")
